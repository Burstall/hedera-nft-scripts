import { Client, PrivateKey, AccountBalanceQuery, Hbar, AccountId, TokenAssociateTransaction, TransferTransaction, TokenId } from '@hashgraph/sdk';
import dotenv from 'dotenv';
dotenv.config();
import fetch from 'cross-fetch';
import { exit } from 'process';


const maxRetries = 10;
let verbose = false;
const env = process.env.ENVIRONMENT ?? null;
const memo = process.env.MEMO || 'Airdrop';
const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';


async function getTokenBalanceMap(tokenId) {

	let routeUrl = '/api/v1/tokens/' + tokenId + '/balances/';
	const baseUrl = env == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;
	const tokenBalMap = new Map();
	try {
		do {
			if (verbose) console.log(baseUrl + routeUrl);
			const json = await fetchJson(baseUrl + routeUrl);
			if (json == null) {
				console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
				// unlikely to get here but a sensible default
				return;
			}

			for (let b = 0 ; b < json.balances.length; b++) {
				const entry = json.balances[b];
				const account = entry.account;
				const balance = entry.balance;

				tokenBalMap.set(account, balance);
			}

			routeUrl = json.links.next;
		}
		while (routeUrl);
		if (verbose) console.log(tokenBalMap);
		return tokenBalMap;
	}
	catch (err) {
		console.log('Trying to find balances for', tokenId, baseUrl, routeUrl);
		console.error(err);
		exit(1);
	}
}

async function getSerialsOwned(tokenId, wallet, excludeSerialsList = []) {
	const baseUrl = env == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;

	const serialArr = [];
	let routeUrl = '/api/v1/tokens/' + tokenId + '/nfts?account.id=' + wallet;

	console.log('Fetching serials owned: ', baseUrl + routeUrl);

	try {
		do {
			const json = await fetchJson(baseUrl + routeUrl);

			for (let n = 0; n < json.nfts.length; n++) {
				const nft = json.nfts[n];
				const serial = nft.serial_number;
				if (!excludeSerialsList.includes(serial)) serialArr.push(serial);
			}

			routeUrl = json.links.next;
		}
		while (routeUrl);

		// ensure the array of serials is randomised.
		return serialArr;
	}
	catch (err) {
		console.log('Trying to find serials owned', wallet, baseUrl, routeUrl, serialArr);
		console.error(err);
		exit(1);
	}
}

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	if (depth > (maxRetries / 2) && verbose) console.log('Attempt: ', depth, url);
	depth++;
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			await sleep(500 * depth);
			return await fetchJson(url, depth);
		}
		return res.json();
	}
	catch (err) {
		await sleep(500 * depth);
		return await fetchJson(url, depth);
	}
}

function getArg(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customIndex > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customIndex + 1];
	}

	return customValue;
}

function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(resource, options = {}) {
	const { timeout = 30000 } = options;
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const response = await fetch(resource, {
		...options,
		signal: controller.signal,
	});
	clearTimeout(id);
	return response;
}

async function executeTransaction(signedTx, client, batchNum) {
	console.log(`(Batch #${batchNum}) Tx being sent.`);
	try {
		const tokenTransferSubmit = await signedTx.execute(client);
		// check it worked
		const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
		console.log(`(Batch #${batchNum}) Tx processed - status:`, tokenTransferRx.status.toString());
	}
	catch (err) {
		console.log('Error occured executing tx:', err);
	}
}

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node NFTTransferTwoPKs.mjs -t <token> [-s <serials> | -r X] [-v]');
		console.log('Designed to move **ALL** of a token from one account to another when you have both keys');
		console.log('       -t token		the token to move');
		console.log('       -s <serials>    transgfer specific serial(s)');
		console.log('             (comma seperated or - for range e.g. 2,5,10 or 1-10)');
		console.log('       -r X            transfer a random X serials');
		console.log('       -v          		verbose [debug]');
		return;
	}

	const senderAcctId = process.env.SENDER_ACCOUNT_ID;
	const senderPK = PrivateKey.fromString(process.env.SENDER_PRIVATE_KEY);
	const recAccountId = process.env.RECEIVE_ACCOUNT_ID;
	const recPrivateKey = PrivateKey.fromString(process.env.RECEIVE_PRIVATE_KEY);

	// If we weren't able to grab it, we should throw a new error
	if (!senderAcctId ||
		!senderPK || !recAccountId || !recPrivateKey) {
		throw new Error('variables for account ID / PKs must be present');
	}

	console.log('SENDER:', senderAcctId);
	console.log('RECEIVER:', recAccountId);

	const recAccountIdFromString = AccountId.fromString(recAccountId);
	const senderAccountIdFromString = AccountId.fromString(senderAcctId);

	console.log('Using ENIVRONMENT:', env);
	console.log('Using MEMO:', memo);

	verbose = getArgFlag('v');

	if (env === undefined || env == null) {
		console.log('Environment required, please specify test or main in the .env file');
		return;
	}

	// known ID NFT used
	// aim: transfer between two accounts
	let tokenId;

	if (getArgFlag('t')) {
		tokenId = getArg('t');
	}
	else {
		console.log('Token must be set. Please run again with -t <token>');
	}

	console.log('TOKEN:', tokenId);

	let tokenBalMap = await getTokenBalanceMap(tokenId);

	let requestedSerialsList = [];
	if (getArgFlag('s')) {
		const serialsArg = getArg('s');

		// format csv or '-' for range
		if (serialsArg.includes('-')) {
			// inclusive range
			const rangeSplit = serialsArg.split('-');
			for (let i = rangeSplit[0]; i <= rangeSplit[1]; i++) {
				requestedSerialsList.push(`${i}`);
			}
		}
		else if (serialsArg.includes(',')) {
			requestedSerialsList = serialsArg.split(',');
		}
		else {
			// only one serial to check
			requestedSerialsList = [serialsArg];
		}

	}

	const ownedSerialsList = await getSerialsOwned(tokenId, senderAcctId);

	console.log(`Found ${ownedSerialsList.length} serials on account ${senderAcctId}`);

	let selectedSerialsList = [];

	if (getArgFlag('r')) {
		const randSize = Number(getArg('r'));
		if (randSize > ownedSerialsList.length) {
			console.log('Requested more random serials than owned - exiting');
			console.log('REQUESTED:', randSize);
			console.log('OWNED:', ownedSerialsList.length);
			process.exit(1);
		}
		const shuffledSerials = shuffleArray(ownedSerialsList);
		selectedSerialsList = shuffledSerials.slice(0, randSize);
		console.log(`Sending ${selectedSerialsList.length} serials **RANDOMLY PICKED**`, selectedSerialsList);

	}
	else if (requestedSerialsList.length > 0) {
		// check the requested serials are owned
		if (requestedSerialsList.every(elem => ownedSerialsList.includes(elem))) {
			console.log(`Sending ${requestedSerialsList.length} serials`, requestedSerialsList);
			selectedSerialsList = ownedSerialsList;
		}
		else {
			console.log('Sending account does not own all serials specified -- exiting');
			console.log('REQUESTED:', requestedSerialsList);
			console.log('OWNED:', ownedSerialsList);
			process.exit(1);
		}
	}
	else {
		// all
		selectedSerialsList = ownedSerialsList;
		console.log('Sending **ALL** serials');
	}

	// Create our connection to the Hedera network
	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('Sending tokens in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('Sending tokens in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}


	client.setOperator(recAccountIdFromString, recPrivateKey);

	const tokenIdFromString = TokenId.fromString(tokenId);

	const recActBalQueryPreTx = await new AccountBalanceQuery()
		.setAccountId(recAccountId)
		.execute(client);

	const recActBalPreTx = recActBalQueryPreTx.tokens._map.get(tokenId.toString());

	// check association to other account
	// check mirror node and live network call
	if (!tokenBalMap.get(recAccountId) && !recActBalPreTx) {
		console.log(`- ${recAccountId} needs to associate NFT with ID ${tokenId}`);

		// associate
		// Create the associate transaction and sign with Alice's key
		const associateRecTx = await new TokenAssociateTransaction()
			.setAccountId(recAccountIdFromString)
			.setTokenIds([tokenIdFromString])
			.freezeWith(client)
			.sign(recPrivateKey);

		// Submit the transaction to a Hedera network
		const associateRecTxSubmit = await associateRecTx.execute(client);

		// Get the transaction receipt
		const associateRecRx = await associateRecTxSubmit.getReceipt(client);

		// Confirm the association was successful
		console.log(`- NFT association to ${recAccountId} account for NFT ${tokenId}: ${associateRecRx.status}\n`);

	}
	else {
		console.log(`${recAccountId} balance: ${tokenBalMap.get(recAccountId)} NFT(s) of ID ${tokenId}`);
	}

	// Now send the tokens!
	// 10 items per tx -> 8 for NFT & 2 for economics
	const nftBatchSize = 8;
	// step 1: break transactions into parts
	// process easch instruction seperately to ensure success/failure lines up (less efficient of course).
	// more important for NFTs given unique...FT can aggregate.

	const promiseArray = [];
	let txCount = 0;

	for (let outer = 0; outer < selectedSerialsList.length; outer += nftBatchSize) {
		txCount++;
		const tokenTransferTx = new TransferTransaction();
		for (let inner = 0; (inner < nftBatchSize) && ((outer + inner) < selectedSerialsList.length); inner++) {
			const serial = selectedSerialsList[outer + inner];
			tokenTransferTx.addNftTransfer(tokenIdFromString, serial, senderAccountIdFromString, recAccountIdFromString);
			if (verbose) console.log(`Adding serial ${serial} of ${tokenId} to tx to send to ${recAccountId} from ${senderAcctId}`);
		}
		// need to expose economics given not treasury account
		if (verbose) console.log('Sending NFT(s)');
		tokenTransferTx
			.addHbarTransfer(recAccountIdFromString, new Hbar(-0.001))
			.addHbarTransfer(senderAccountIdFromString, new Hbar(0.001))
			.setTransactionMemo(memo)
			.freezeWith(client);

		// sign
		let signedTx = await tokenTransferTx.sign(senderPK);
		signedTx = await tokenTransferTx.sign(recPrivateKey);
		// submit
		promiseArray.push(executeTransaction(signedTx, client, txCount));
	}

	await Promise.all(promiseArray);

	// check balances on all accounts
	const senderActBal = await new AccountBalanceQuery()
		.setAccountId(senderAcctId)
		.execute(client);
	const recActBal = await new AccountBalanceQuery()
		.setAccountId(recAccountId)
		.execute(client);
	// refresh ownership from mirror nodes
	tokenBalMap = await getTokenBalanceMap(tokenId);

	console.log(`- ${senderAcctId} balance: ${senderActBal.tokens._map.get(tokenId.toString())} NFT(s) [network] / ${tokenBalMap.get(senderAcctId)} [mirror nodes] of ID ${tokenId}`);
	console.log('Sender HBAR balance is: ' + senderActBal.hbars);
	console.log(`- ${recAccountId} balance: ${recActBal.tokens._map.get(tokenId.toString())} NFT(s) [network] / ${tokenBalMap.get(recAccountId)} [mirror nodes] of ID ${tokenId}`);
	console.log('Receiver HBAR balance is: ' + recActBal.hbars);

}


function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

main();
