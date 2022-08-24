require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenDeleteTransaction,
} = require('@hashgraph/sdk');

// Configure accounts and client, and generate needed keys
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const adminKey = PrivateKey.fromString(process.env.ADMIN_KEY);
const env = process.env.ENVIRONMENT ?? null;

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
		console.log('Usage: node deleteToken.js');
		process.exit(0);
	}

	// Get the token ID
	const tokenId = process.env.TOKEN_ID;

	// Log the token ID
	console.log(`- Burning Token ID: ${tokenId}`);
	console.log(`- Using account: ${operatorId} to pay`);

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('- Deleting token in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('- Deleting token in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const transaction = new TokenDeleteTransaction()
		.setTokenId(tokenId)
		.freezeWith(client);

	// Sign with the supply private key of the token
	const signTx = await transaction.sign(adminKey);

	// Submit the transaction to a Hedera network
	const txResponse = await signTx.execute(client);

	// Request the receipt of the transaction
	const receipt = await txResponse.getReceipt(client);

	// Get the transaction consensus status
	const transactionStatus = receipt.status;

	console.log('The transaction consensus status ' + transactionStatus.toString());

	console.log('Deletion complete');
}

main();
