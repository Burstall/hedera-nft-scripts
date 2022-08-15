const {
	Client,
	PrivateKey,
	AccountId,
	AccountAllowanceApproveTransaction,
	Hbar,
	NftId,
	TokenId,
} = require('@hashgraph/sdk');
const exit = require('node:process');
require('dotenv').config();
const fetch = require('cross-fetch');

/**
https://testnet.mirrornode.hedera.com/api/v1/tokens/0.0.47540431/nfts

hbar allowances
https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.2777997/allowances/crypto
FT allowances
https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.2777997/allowances/tokens

...no url for NFT allowances

0.0.47698672

*/

const maxRetries = 5;
const testBaseURL = 'https://testnet.mirrornode.hedera.com';
const mainBaseURL = 'https://mainnet-public.mirrornode.hedera.com';
const allowanceURL = '/api/v1/accounts/';
const allowanceFTEnd = '/allowances/tokens?limit=100';
const allowanceNFTEnd = '/allowances/crypto?limit=100';
const tokensURL = '/api/v1/tokens/';
let verbose = false;

const addressRegex = /(0\.0\.[1-9][0-9]+)/i;
let env;

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

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	depth++;
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			if (depth > 4) console.log(depth, url, res);
			await sleep(2000 * depth);
			return await fetchJson(url, depth);
		}
		return res.json();

	}
	catch (err) {
		await sleep(3000 * depth);
		return await fetchJson(url, depth);
	}
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

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
};

function readyClient() {
	const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
	const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

	// If we weren't able to grab it, we should throw a new error
	if (operatorId == null ||
        operatorKey == null) {
		throw new Error('Environment variables for account ID / PKs must be present');
	}

	console.log(`Using wallet ${operatorId} to pay / sign`);

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('- Processing allowances in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('- Processing allowances in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	return [client, operatorId, operatorKey];
}

async function revoke(tokenId = null) {
	// TODO: const [client, operatorId, operatorKey] = readyClient();

	// casn only revoke 20 serials in a transaction
	// https://docs.hedera.com/guides/docs/sdks/cryptocurrency/adjust-an-allowance

	if (tokenId) {
		// remove allowances for the specified token only
	}
	else {
		// remove all allowances.
	}
}

async function setNFTAllowance(wallet, tokenIdString, serialsList, allSerialsArg = false) {
	const tokenId = TokenId.fromString(tokenIdString);
	const [client, operatorId, operatorKey] = readyClient();
	// https://docs.hedera.com/guides/docs/sdks/cryptocurrency/approve-an-allowance
	// **an account is limited to 100 allowances of tokens // no limit on number serials of a given token**

	if (allSerialsArg) {
		const transaction = new AccountAllowanceApproveTransaction()
			.approveTokenNftAllowanceAllSerials(tokenId, operatorId, wallet);

		console.log(`Setting *NFT* allowance for ${wallet} to spend **ALL** NFTs of ${tokenId} on behalf of ${operatorId}`);
		transaction.freezeWith(client);
		const signTx = await transaction.sign(operatorKey);
		const txResponse = await signTx.execute(client);
		const receipt = await txResponse.getReceipt(client);
		const transactionStatus = receipt.status;
		console.log('The transaction consensus status is ' + transactionStatus.toString());
	}
	else {
		// note - only 20 serials can be set in a single transaction
		for (let outer = 0; outer < serialsList.length; outer = outer + 20) {
			const transaction = new AccountAllowanceApproveTransaction();
			const txSerialsList = [];
			for (let inner = 0; (outer + inner) < serialsList.length; inner++) {
				const nftId = new NftId(tokenId, serialsList[inner + outer]);
				txSerialsList.push(nftId.serial);
				console.log(nftId);
				transaction.approveTokenNftAllowance(nftId, operatorId, wallet);
			}
			console.log(`Setting *NFT* allowance for ${wallet} to spend ${txSerialsList.length} serials (${txSerialsList}) of NFT ${tokenId} on behalf of ${operatorId}`);
			transaction.freezeWith(client);
			const signTx = await transaction.sign(operatorKey);
			const txResponse = await signTx.execute(client);
			const receipt = await txResponse.getReceipt(client);
			const transactionStatus = receipt.status;
			console.log('The transaction consensus status is ' + transactionStatus.toString());
		}
	}
}

async function setFungibleAllowance(wallet, tokenId, amount) {
	const [client, operatorId, operatorKey] = readyClient();
	// note - only 20 serials can be set in a single transaction
	// https://docs.hedera.com/guides/docs/sdks/cryptocurrency/approve-an-allowance
	// **an account is limited to 100 allowances of tokens // no limit on number serials of a given token**

	const transaction = new AccountAllowanceApproveTransaction()
		.approveTokenAllowance(tokenId, operatorId, wallet, amount);

	console.log(`Setting *FT* allowance for ${wallet} to spend ${amount} of FT ${tokenId} on behalf of ${operatorId}`);
	transaction.freezeWith(client);
	const signTx = await transaction.sign(operatorKey);
	const txResponse = await signTx.execute(client);
	const receipt = await txResponse.getReceipt(client);
	const transactionStatus = receipt.status;
	console.log('The transaction consensus status is ' + transactionStatus.toString());
}

async function setHbarAllowance(wallet, amount) {
	const [client, operatorId, operatorKey] = readyClient();

	const transaction = new AccountAllowanceApproveTransaction()
		.approveHbarAllowance(operatorId, wallet, Hbar.from(amount));

	console.log(`Setting *HBAR* allowance for ${wallet} to spend ${amount} Hbar on behalf of ${operatorId}`);
	transaction.freezeWith(client);
	const signTx = await transaction.sign(operatorKey);
	const txResponse = await signTx.execute(client);
	const receipt = await txResponse.getReceipt(client);
	const transactionStatus = receipt.status;
	console.log('The transaction consensus status is ' + transactionStatus.toString());
}

async function isTokenNFT(baseUrl, tokenId) {
	const routeUrl = tokensURL + tokenId;

	if (verbose) console.log('checking token type:', baseUrl + routeUrl);

	const tokenDetailJSON = await fetchJson(baseUrl + routeUrl);

	const tokenType = tokenDetailJSON.type;

	if (tokenType === 'NON_FUNGIBLE_UNIQUE') {
		return true;
	}
	else {
		return false;
	}
}

async function getAllowances(wallet, baseUrl, isNFT) {
	let routeUrl;
	if (isNFT) {
		routeUrl = allowanceURL + wallet + allowanceNFTEnd;
	}
	else {
		routeUrl = allowanceURL + wallet + allowanceFTEnd;
	}

	if (verbose) { console.log(baseUrl + routeUrl);}

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no Allowances found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const allowances = json.allowances;

		console.log('Allowances found:', allowances.length);

		for (let a = 0; a < allowances.length; a++) {
			const value = allowances[a];
			console.log(value);
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);
}

async function main() {
	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node alowanceSetCheckRevoke.js [-t 0.0.XXX] [-w 0.0.WWW] [-revoke [-hbar]] [-set 0.0.ZZZZ [-serial Q | -all | -hbar <amt> | -amt <amt>] [-v]');
		console.log('       -t <tokenId>	token to check allowances of (defaults: ALL)');
		console.log('       -w <walletId>	wallet to check allowances of (default: MY_ACCOUNT_ID fron .env)');
		console.log('       -revoke 		revokes allowances for the token specified or **ALL** allowances');
		console.log('       	-hbar  		revoke only hbar allowances');
		console.log('       -set <walletId>	set new allowance for the token specified (-t) to the stated wallet');
		console.log('       	-serial Q 	required if the token is a NFT. Q can be single serial (e.g. 4) or comma seperated list (e.g. 4,9,11) or range using - (e.g. 2-8)');
		console.log('       	-all 		set approval for all serials owned of a given NFT');
		console.log('       	-hbar <amt> set approval for "amt" of hbar');
		console.log('       	-amt <amt> 	set approval of "amt" of Fungible token');
		exit.exit(0);
	}

	verbose = getArgFlag('v');
	// load from env file
	const myAccountId = process.env.MY_ACCOUNT_ID;
	// overide from command line or fall back to env file value
	const acctId = getArgFlag('w') ? getArg('w') : myAccountId;
	const walletId = acctId.match(addressRegex)[0];

	env = process.env.ENVIRONMENT.toUpperCase() || null;

	let baseUrl;
	if (env == 'TEST') {
		console.log('- Checking allowances in *TESTNET*');
		baseUrl = testBaseURL;
	}
	else if (env == 'MAIN') {
		console.log('- Checking allowances in *MAINNET*');
		baseUrl = mainBaseURL;
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	if (getArgFlag('set') && getArgFlag('revoke')) {
		console.log('Please pick revoke **OR** set and run again - can\'t do both so exiting');
		exit.exit(1);
	}

	const tokenArg = getArg('t') || null;
	let tokenId;
	const serialsArg = getArg('serial') || null;
	let serialsList = [];
	const allSerialsArg = getArg('all') || null;
	// check if this is an NFT, if so has serial been set?
	let isNFT;
	if (tokenArg) {
		tokenId = tokenArg.match(addressRegex)[0];
		console.log('Using token:', tokenId);
		isNFT = await isTokenNFT(baseUrl, tokenId);
	}
	else {
		isNFT = false;
	}

	// TODO decide format and merge? isNFT
	await getAllowances(walletId, baseUrl, true);
	await getAllowances(walletId, baseUrl, false);

	if (getArgFlag('set')) {
		const setArg = getArg('set');
		const allowWallet = setArg.match(addressRegex)[0];

		if (getArgFlag('hbar')) {
			const amt = getArg('hbar');
			await setHbarAllowance(allowWallet, amt);
		}
		else if (!tokenArg) {
			console.log('Must specify a token to set allowances for using: -t 0.0.XXX');
			exit.exit(1);
		}
		else if (isNFT) {
			if (allSerialsArg) {
				await setNFTAllowance(allowWallet, tokenId, serialsList, true);
			}
			else {
				if (!serialsArg) {
					console.log('ERROR: must specify a serial to set an allowance for NFT:', tokenId);
				}
				else if (isNFT && allSerialsArg) {
					serialsList = [];
				}
				else if (isNFT && serialsArg.includes('-')) {
					// inclusive range
					const rangeSplit = serialsArg.split('-');
					for (let i = rangeSplit[0]; i <= rangeSplit[1]; i++) {
						serialsList.push(`${i}`);
					}
				}
				else if (isNFT && serialsArg.includes(',')) {
					serialsList = serialsArg.split(',');
				}
				else if (isNFT) {
					// only one serial to check
					serialsList = [serialsArg];
				}
				await setNFTAllowance(allowWallet, tokenId, serialsList, false);
			}
		}
		else {
			const amtArg = getArg('amt') || null;
			if (amtArg) {
				const amt = Number(amtArg);
				await setFungibleAllowance(allowWallet, tokenId, amt);
			}
			else {
				console.log(`Error: must specify the amnount (XXX) of an FT to allow -> node alowanceSetCheckRevoke.js -t ${tokenId} -set ${allowWallet} -amt XXX`);
				exit.exit(1);
			}
		}
	}

	if (getArgFlag(revoke)) {
		await revoke(tokenArg ? tokenId : null);
	}

}

main();