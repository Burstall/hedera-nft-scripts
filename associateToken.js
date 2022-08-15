const {
	Client, PrivateKey, AccountBalanceQuery, TokenAssociateTransaction, TokenDissociateTransaction, TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fetch = require('cross-fetch');

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const maxRetries = 3;
let env;


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
		process.exit(1);
	}
}

const accountTokenOwnershipMap = new Map();
let verbose = false;

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

async function main() {

	// Grab your Hedera testnet account ID and private key from your .env file

	const myAccountId = process.env.MY_ACCOUNT_ID;
	const myPrivateKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

	// If we weren't able to grab it, we should throw a new error
	if (myAccountId == null ||
        myPrivateKey == null) {
		throw new Error('Environment variables for account ID / PKs must be present');
	}

	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node associateToken.js -e [test|main] -t <tokenId> -a [ass|dis]');
		console.log('                -t <tokenId> tokenID or can be , seperated (no spaces)');
		console.log('                      e.g. 0.0.614759,0.0.614777,0.0.727536');
		console.log('                -a [ass|dis] associate or disassociate');
		process.exit(0);
	}
	const tokenId = getArg('t');
	const tokenListFile = getArg('l');
	const tokenList = [];
	if (tokenId === undefined && tokenListFile === undefined) {
		console.log('token ID or list required, run: node associateToken.js -h ');
		process.exit(1);
	}
	if (!tokenListFile === undefined) {
		// TODO: read in tokens
	}
	else {
		// check if tokens are comma seperated
		const commaList = tokenId.split(',');
		for (let i = 0; i < commaList.length; i++) {
			tokenList.push(commaList[i]);
		}
	}

	const action = getArg('a');
	let associate;
	if (action == 'ass') {
		associate = true;
	}
	else if (action == 'dis') {
		associate = false;
	}
	else {
		console.log('Need to specify ass(ociate) or dis(associate) -> run: node associateToken.js -h ');
		process.exit(1);
	}

	env = getArg('e');
	if (env === undefined) {
		console.log('Environment required, specify test or main -> run: node associateToken.js -h ');
		process.exit(1);
	}

	verbose = getArgFlag('v');

	const force = getArgFlag('force');

	let tokenListString = '';
	for (let i = 0 ; i < tokenList.length; i++) {
		if (tokenListString == '') { tokenListString += `${tokenList[i]}`; }
		else { tokenListString += `, ${tokenList[i]}`; }
	}

	console.log(`action: ${action} on ${myAccountId} for tokens: ${tokenListString}`);


	// Create our connection to the Hedera network
	let client;
	if (env == 'main') {
		client = Client.forMainnet().setOperator(
			myAccountId,
			myPrivateKey,
		);

		env = 'MAIN';
	}
	else if (env == 'test') {
		client = Client.forTestnet().setOperator(
			myAccountId,
			myPrivateKey,
		);

		env = 'TEST';
	}
	else {
		console.log('must specify -e with \'test\' or \'main\' -- no quotes!');
		return;
	}

	let tokenIdFromString;

	// run pre checks to allow bulk processing
	const checkedTokenList = [];
	for (let c = 0; c < tokenList.length; c++) {
		tokenIdFromString = TokenId.fromString(tokenList[c]);
		console.log(`pre-check: ${tokenIdFromString}`);

		//* *CHARGEABLE** consider moving to mirror nodes
		const [ownedBalance, mirrorNodeOwnedBalance] = await checkAccountBalances(myAccountId, tokenIdFromString, client);
		if (associate) {
			if (ownedBalance >= 0) {
				// already countAssociated
				console.log(`Skipping: ${myAccountId} already has ${tokenIdFromString} associated`);
				continue;
			}
			else {
				checkedTokenList.push(tokenIdFromString);
			}
		}
		else if (ownedBalance < 0 && mirrorNodeOwnedBalance < 0) {
			// already countAssociated
			console.log(`Skipping: ${myAccountId} already has ${tokenIdFromString} DISassociated`);
			continue;
		}
		else if (ownedBalance > 0 && !force) {
			console.log(`Skipping: ${myAccountId} still owns ${ownedBalance} -> ${tokenIdFromString} use -force to overide`);
			continue;
		}
		else {
			checkedTokenList.push(tokenIdFromString);
		}
	}


	if (checkedTokenList.length == 0) {
		console.log('No tokens passed the pre-check');
		process.exit(1);
	}


	let transaction;
	if (associate) {
		transaction = await new TokenAssociateTransaction()
			.setAccountId(myAccountId)
			.setTokenIds(checkedTokenList)
			.freezeWith(client)
			.sign(myPrivateKey);
	}
	else {
		// Dissociate a token from an account and freeze the unsigned transaction for signing
		transaction = await new TokenDissociateTransaction()
			.setAccountId(myAccountId)
			.setTokenIds(checkedTokenList)
			.freezeWith(client)
			.sign(myPrivateKey);
	}

	const tokenTransferSubmit = await transaction.execute(client);
	const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);

	console.log('The transaction consensus status is ' + tokenTransferRx.status.toString());

	console.log('Running verification:');
	for (let z = 0; z < checkedTokenList.length; z++) {
		await checkAccountBalances(myAccountId, checkedTokenList[z], client, z ? 0 : true, false);
	}

	process.exit(0);
}

async function checkAccountBalances(accountId, tokenId, client, force = false) {
	// Save multiple transactions byt using a Map of existing results
	// force option to get an update
	let tokenMap = accountTokenOwnershipMap.get(accountId) || null;
	const mirrorNodeTokenBalMap = await getTokenBalanceMap(tokenId);
	if (tokenMap == null || force) {
		const balanceCheckTx = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
		tokenMap = balanceCheckTx.tokens._map;
		console.log(`Found ${tokenMap.size} unique associated tokens`);
	}

	const ownedBalance = tokenMap.get(`${tokenId}`) || -1;
	const mirrorNodeOwnedBalance = mirrorNodeTokenBalMap.get(`${accountId}`);

	if (verbose) {
		tokenMap.forEach((key, value) => {
			console.log(key, value);
		});
	}

	// console.log(tokenId, balanceCheckTx.tokens);
	if (ownedBalance < 0) {
		console.log(`- NETWORK ${accountId} does not have ${tokenId} associated`);
	}
	else {
		console.log(`- NETWORK ${accountId} balance: ${ownedBalance} NFT(s) of ID ${tokenId}`);
	}

	if (mirrorNodeOwnedBalance < 0) {
		console.log(`- MIRROR NODE ${accountId} does not have ${tokenId} associated`);
	}
	else {
		console.log(`- MIRROR NODE ${accountId} balance: ${mirrorNodeOwnedBalance} NFT(s) of ID ${tokenId}`);
	}
	return [ownedBalance, mirrorNodeOwnedBalance];
}

async function fetchJson(url, depth = 0) {

	if (depth >= maxRetries) return null;
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

async function fetchWithTimeout(resource, options = {}) {
	const { timeout = 5000 } = options;

	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const response = await fetch(resource, {
		...options,
		signal: controller.signal,
	});
	clearTimeout(id);
	return response;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

main();
