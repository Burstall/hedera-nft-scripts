require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenBurnTransaction,
} = require('@hashgraph/sdk');

const fetch = require('cross-fetch');

// Configure accounts and client, and generate needed keys
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const supplyKey = PrivateKey.fromString(process.env.SUPPLY_KEY);
const env = process.env.ENVIRONMENT ?? null;
const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const maxRetries = 6;

async function getTokenType(tokenId) {
	const baseUrl = env == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;
	const routeUrl = `/api/v1/tokens/${tokenId}`;

	const tokenDetailJSON = await fetchJson(baseUrl + routeUrl);

	return [tokenDetailJSON.type, tokenDetailJSON.decimals];
}

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	if (depth > (maxRetries / 2)) console.log('Attempt: ', depth, url);
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

	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node burnFT.js -amt XXX');
		console.log('       -amt 	XXXX to burn');
		process.exit(0);
	}

	// Get the token ID
	const tokenId = process.env.TOKEN_ID;

	// Log the token ID
	console.log(`- Burning supply from FT with Token ID: ${tokenId} \n`);
	console.log(`- Using account: ${operatorId} to pay`);

	const [type, decimal] = await getTokenType(tokenId);

	if (type != 'FUNGIBLE_COMMON') {
		console.log(`Token is of type ${type} and not suitable for this command`);
		process.exit(1);
	}

	const amt = Number(getArg('amt'));
	if (!amt) {
		console.log('Must specify how many to burn');
	}

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('- Burning tokens in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('- Burning tokens in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	console.log(`Burning ${amt} tokens`);

	client.setOperator(operatorId, operatorKey);

	const transaction = new TokenBurnTransaction()
		.setTokenId(tokenId)
		.setAmount(amt * (10 ** decimal))
		.freezeWith(client);

	// Sign with the supply private key of the token
	const signTx = await transaction.sign(supplyKey);

	// Submit the transaction to a Hedera network
	const txResponse = await signTx.execute(client);

	// Request the receipt of the transaction
	const receipt = await txResponse.getReceipt(client);

	// Get the transaction consensus status
	const transactionStatus = receipt.status;

	console.log('The transaction consensus status ' + transactionStatus.toString());

	console.log('Burn complete');
}

main();
