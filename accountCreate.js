require('dotenv').config();
const { AccountCreateTransaction, Hbar, PublicKey, Client, PrivateKey, AccountId } = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');

let client;

async function main() {
	if (getArgFlag('h') || !getArgFlag('key')) {
		console.log('Usage: node accountCreate.js -key <public key> [-ecdsa]');
		console.log('       -key	public key of account to create');
		console.log('       -ecdsa	use EDCSA key (default is ED25519)');
		process.exit(0);
	}

	// Create our connection to the Hedera network
	client = Client.forTestnet();

	// If we weren't able to grab it, we should throw a new error
	if (process.env.MY_ACCOUNT_ID == null || process.env.MY_PRIVATE_KEY == null) {
		throw new Error(
			'Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present',
		);
	}

	// Set the client account ID and private key used to pay for transaction fees and sign transactions
	client.setOperator(AccountId.fromString(process.env.MY_ACCOUNT_ID), PrivateKey.fromString(process.env.MY_PRIVATE_KEY));
	const keyString = getArg('key');
	let key, type;
	if (getArgFlag('ecdsa')) {
		key = PublicKey.fromStringECDSA(keyString);
		type = 'ECDSA';
	}
	else {
		key = PublicKey.fromStringED25519(keyString);
		type = 'ED25519';
	}
	console.log('Using opetator account ' + process.env.MY_ACCOUNT_ID + ' to create a new account');
	console.log('Using public key: ' + keyString + ' type: ' + type);
	console.log('In **TESTNET**');
	const execute = readlineSync.keyInYNStrict('Do wish to create a new account?');
	// Create a new account with 1,000 tinybar starting balance
	if (!execute) {
		console.log('Exiting');
		process.exit(0);
	}
	const newAccountId = await accountCreator(
		key,
		10);

	console.log('The new account ID is: ' + newAccountId);
}

/**
 * Helper function to create new accounts
 * @param {PublicKey} pubKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the newly created Account ID object
 */
async function accountCreator(pubKey, initialBalance, maxTokenAssociations = 0) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		.setMaxAutomaticTokenAssociations(maxTokenAssociations)
		.setKey(pubKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
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

main();