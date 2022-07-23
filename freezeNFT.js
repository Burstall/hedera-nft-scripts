require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenFreezeTransaction,
	TokenUnfreezeTransaction,
	TokenId,
} = require('@hashgraph/sdk');

// Configure accounts and client, and generate needed keys
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const freezeKey = PrivateKey.fromString(process.env.FREEZE_KEY);
const tokenId = TokenId.fromString(process.env.TOKEN_ID);
const env = process.env.ENVIRONMENT ?? null;

console.log(`- using account: ${operatorId}`);

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
		console.log('Usage: node freezeNFT.js -acc <wallet> [-unfreeze]');
		console.log('           -acc <wallet>  this is the wallet address to free/unfreeze');
		console.log('           -unfreeze      if specified will unfreeze wallet (default: freeze operation)');
		process.exit(0);
	}

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('Freezing tokens in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('Freezing tokens in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	let accountId;
	if (getArgFlag('acc')) {
		accountId = getArg('acc');
	}
	else {
		console.log('ERROR: must specify account to freeze');
		return;
	}

	const freeze = getArgFlag('unfreeze') ? false : true;

	// Log the token ID
	if (freeze) console.log(`- freezing Token ${tokenId} for account ${accountId}`);
	else console.log(`- **UNfreezing** Token ${tokenId} for account ${accountId}`);

	let transaction;
	// Freeze an account from transferring a token
	if (freeze) {
		transaction = new TokenFreezeTransaction()
			.setAccountId(accountId)
			.setTokenId(tokenId)
			.freezeWith(client);
	}
	else {
		transaction = new TokenUnfreezeTransaction()
			.setAccountId(accountId)
			.setTokenId(tokenId)
			.freezeWith(client);
	}

	// Sign with the freeze key of the token
	const signTx = await transaction.sign(freezeKey);

	// Submit the transaction to a Hedera network
	const txResponse = await signTx.execute(client);

	// Request the receipt of the transaction
	const receipt = await txResponse.getReceipt(client);

	// Get the transaction consensus status
	const transactionStatus = receipt.status;

	console.log('The transaction consensus status ' + transactionStatus.toString());

}

main();