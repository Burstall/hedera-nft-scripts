require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenBurnTransaction,
} = require('@hashgraph/sdk');

// Configure accounts and client, and generate needed keys
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const supplyKey = PrivateKey.fromString(process.env.SUPPLY_KEY);
const env = process.env.ENVIRONMENT ?? null;

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
		console.log('Usage: node burnNFT.js -s <serials>');
		console.log('       -s <serials> burn specified serials');
		console.log('                    (singular, comma seperated or - for range e.g. 2,5,10 or 1-10)');
		process.exit(0);
	}

	// Get the token ID
	const tokenId = process.env.TOKEN_ID;

	// Log the token ID
	console.log(`- Burning supply from NFT with Token ID: ${tokenId} \n`);
	console.log(`- Using account: ${operatorId} to pay`);

	let serialsList = [];
	const serialsArg = getArg('s');
	if (serialsArg !== undefined) {
		if (tokenId === undefined) {
			console.log('**MUST** specify token to check serials -> Usage: node checkOwnership.js -h');
			return;
		}

		// format csv or '-' for range
		if (serialsArg.includes('-')) {
			// inclusive range
			const rangeSplit = serialsArg.split('-');
			for (let i = rangeSplit[0]; i <= rangeSplit[1]; i++) {
				serialsList.push(`${i}`);
			}
		}
		else if (serialsArg.includes(',')) {
			serialsList = serialsArg.split(',');
		}
		else {
			// only one serial to check
			serialsList = [serialsArg];
		}

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

	const batchSize = 10;

	console.log(`Burning ${serialsList.length} tokens in batches of ${batchSize}`);

	client.setOperator(operatorId, operatorKey);

	const promiseArray = [];
	let batchNum = 0;
	for (let b = 0; b < serialsList.length; b = b + batchSize) {
		batchNum++;
		promiseArray.push(processSerials(tokenId, serialsList.slice(b, b + batchSize), client, batchNum));
	}

	await Promise.all(promiseArray);

	console.log('Burn complete');
}

async function processSerials(tokenId, serialsList, client, batchNum) {
	console.log('Processing batch', batchNum);
	const transaction = new TokenBurnTransaction()
		.setTokenId(tokenId)
		.setSerials(serialsList)
		.freezeWith(client);

	// Sign with the supply private key of the token
	const signTx = await transaction.sign(supplyKey);

	// Submit the transaction to a Hedera network
	const txResponse = await signTx.execute(client);

	// Request the receipt of the transaction
	const receipt = await txResponse.getReceipt(client);

	// Get the transaction consensus status
	const transactionStatus = receipt.status;

	console.log('Batch' + batchNum + ' complete. The transaction consensus status ' + transactionStatus.toString());
}

main();
