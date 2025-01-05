import fetch from 'cross-fetch';
import dotenv from 'dotenv';
import { AccountAllowanceApproveTransaction, AccountId, Client, PrivateKey, TokenId } from '@hashgraph/sdk';
import readlineSync from 'readline-sync';
dotenv.config();

const maxRetries = 10;

let operatorId = process.env.MY_ACCOUNT_ID;
let privateKey = process.env.MY_PRIVATE_KEY;
let env = process.env.ENV || 'mainnet';
let client;
let mirrornode;

if (!operatorId || !privateKey) {
	console.error('Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present');
	process.exit(1);
}

operatorId = AccountId.fromString(operatorId);
try {
	privateKey = PrivateKey.fromStringED25519(privateKey);
}
catch (err) {
	try {
		privateKey = PrivateKey.fromStringECDSA(privateKey);
	}
	catch (err) {
		console.error('Environment variable MY_PRIVATE_KEY must be a valid Ed25519 or ECDSA private key');
		process.exit(1);
	}
}


async function main() {
	prepareEnv();

	console.log('Operator:', operatorId.toString());
	console.log('Environment:', env);

	// get all NFTs approved for all by the operator
	const tokenSpenderMap = await getApprovedForAll(operatorId.toString());

	// consolidate all spenders to display a summary of speender # of allowances
	const spenderMap = new Map();
	for (const spender of tokenSpenderMap.values()) {
		const count = spenderMap.get(spender) || 0;
		spenderMap.set(spender, count + 1);
	}

	console.log('Spender Map', spenderMap);

	// based on the keys of Spender Map ask user which contract they want to revoke all allowances from
	const spenderKeys = Array.from(spenderMap.keys());
	const spenderIndex = readlineSync.keyInSelect(spenderKeys, 'Select spender to revoke all allowances from');
	if (spenderIndex == -1) {
		console.log('No spender selected');
		return;
	}

	const spender = spenderKeys[spenderIndex];

	// get all tokens approved for all by the operator for the selected spender
	const tokens = [];
	for (const [token, s] of tokenSpenderMap) {
		if (s == spender) {
			tokens.push(TokenId.fromString(token));
		}
	}

	console.log('Revoking all allowances for', spender, 'on', tokens.length, 'tokens');

	// revoke all allowances
	await revokeAllAllowances(operatorId, tokens, spender);

	await sleep(5000);

	// check if all allowances for that spender are revoked
	const tokenSpenderMapAfter = await getApprovedForAll(operatorId.toString());

	const tokensAfter = [];
	for (const [token, s] of tokenSpenderMapAfter) {
		if (s == spender) {
			tokensAfter.push(token);
		}
	}

	console.log(`Tokens with allowances after for Spender [${spender}] = tokensAfter.length`);
	if (tokensAfter.length > 0) {
		console.log('Tokens with allowances after:', tokensAfter);
	}
	else {
		console.log('All allowances revoked');
	}

}

/**
 * @param {AccountId | string} owner
 * @param {NftId[]} tokens
 * @param {AccountId | string} spender
 */
async function revokeAllAllowances(owner, tokens, spender) {
	// split tokens into batches of 20
	const batchSize = 20;
	const batches = [];

	for (let i = 0; i < tokens.length; i += batchSize) {
		batches.push(tokens.slice(i, i + batchSize));
	}

	for (const batch of batches) {
		const revokeTx = new AccountAllowanceApproveTransaction();
		for (const token of batch) {
			console.log('Revoking all allowances for', token.toString(), 'to Spender:', spender);
			revokeTx.deleteTokenNftAllowanceAllSerials(token, owner, spender);
		}

		const txResponse = await revokeTx.execute(client);
		const receipt = await txResponse.getReceipt(client);
		console.log('Receipt:', receipt.status.toString(), 'Tx Id:', txResponse.transactionId.toString());
	}
}


async function getApprovedForAll(owner) {
	let url = `${mirrornode}/api/v1/accounts/${owner}/allowances/nfts?limit=100`;

	const tokenSpenderMap = new Map();

	while (url) {
		const json = await fetchJson(url);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', url);
			// unlikely to get here but a sensible default
			return;
		}
		const allowances = json.allowances;

		for (let n = 0; n < allowances.length; n++) {
			const value = allowances[n];
			if (value.approved_for_all) {
				tokenSpenderMap.set(value.token_id, value.spender);
			}
		}

		url = json.links.next;
	}

	return tokenSpenderMap;
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

function prepareEnv() {
	if (env.toUpperCase() == 'TEST' || env.toUpperCase() == 'TESTNET') {
		client = Client.forTestnet();
		env = 'testnet';
		mirrornode = 'https://testnet.mirrornode.hedera.com';
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN' || env.toUpperCase() == 'MAINNET') {
		client = Client.forMainnet();
		env = 'mainnet';
		mirrornode = 'https://mainnet.mirrornode.hedera.com';
		console.log('running in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW' || env.toUpperCase() == 'PREVIEWNET') {
		client = Client.forPreviewnet();
		env = 'previewnet';
		mirrornode = 'https://previewnet.mirrornode.hedera.com';
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		env = 'local';
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		mirrornode = 'http://127.0.0.1:5600';
		console.log('testing in *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, privateKey);
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

main().then(() => {
	console.log('Done');
	process.exit(0);
}).catch(err => {
	console.error(err);
	process.exit(1);
});