const {
	Client,
	PrivateKey,
	AccountUpdateTransaction,
	AccountId,
	Mnemonic,
} = require('@hashgraph/sdk');
const fs = require('fs');
require('dotenv').config();
const exit = require('node:process');
const readlineSync = require('readline-sync');

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
		console.log('Usage: node updatePrivateKey.js [-acc <account>] [-pk <private key>] [-save [<file-name>]] [-test]');
		console.log('       -acc <account> 		supply account to reset on commandline');
		console.log('       	**If not supplied will look for UPDATE_ACCT in .env **');
		console.log('       -pk <private key> 	supply private key to reset on commandline');
		console.log('       	**If not supplied will look for OLD_KEY in .env **');
		console.log('       -save 				use -save to save the *NEW* PK to file');
		console.log('       	**Supresses console output**');
		console.log('       -save <filename>	to specify the file to save to');
		console.log('       -test				run script without changing key');
		console.log('       	**Changing keys is scary - this lets you be double sure connfig looks right**');
		process.exit(0);
	}

	// load details from the .env file
	const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
	const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
	const env = process.env.ENVIRONMENT ?? null;

	// check the account / PK are valid
	if (!operatorId || !operatorKey) {
		console.log('Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present');
		exit(1);
	}
	else {
		console.log(`Using Account ${operatorId} as payer account`);
	}

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('- Changing PK in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('- Changing PK in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// check if save to file requested
	let save = getArgFlag('save');
	// if so see if a filename was supplied
	let filename = getArg('save');

	// check if user wants to save the PK to file
	if (!save) {
		save = readlineSync.keyInYNStrict('Do you want to save your new generated keys to file?\n**HIGHLY RECOMMENDED as if lost the wallet is inaccessible**');
	}

	let acctToChange;

	if (getArgFlag('acc')) {
		acctToChange = getArg('acc');
	}
	else {
		acctToChange = process.env.UPDATE_ACCT;
	}

	let pkString;

	if (getArgFlag('pk')) {
		pkString = getArg('pk');
	}
	else {
		pkString = process.env.OLD_KEY;
	}

	const oldKey = PrivateKey.fromString(pkString);

	console.log('Generating new keys...');
	// Generate New key
	const mnemonic = await Mnemonic.generate();
	const newKey = await mnemonic.toPrivateKey();

	// Call regenerate key
	console.log('Updating account', acctToChange, 'with new Key...');

	if (!getArgFlag('test')) {

		// Create the transaction to update the key on the account
		const transaction = new AccountUpdateTransaction()
			.setAccountId(acctToChange)
			.setKey(newKey)
			.freezeWith(client);

		// Sign the transaction with the old key and new key
		const signTx = await (await transaction.sign(oldKey)).sign(newKey);

		// execute the signed transaction
		const txResponse = await signTx.execute(client);

		// Request the receipt of the transaction
		const receipt = await txResponse.getReceipt(client);

		// Get the transaction consensus status
		const transactionStatus = receipt.status;

		console.log('The transaction consensus status is ' + transactionStatus.toString());

	}
	else {
		console.log('**TEST MODE** skipping interaction with Hedera network -- **NO KEYS CHANGED**');
	}

	const outputString = 'Account:\n'
							+ acctToChange
							+ '\nMnemonic:\n'
							+ mnemonic.toString()
							+ '\nNew Private Key:\n'
							+ newKey.toString()
							+ '\nNew Public Key:\n'
							+ newKey.publicKey;

	if (save) {
		// write to the filename specified
		try {
			// if no filename supllied use default
			if (!filename) {
				const startTime = new Date();
				const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
				filename = `./${acctToChange}-PK-${timestamp}.txt`;
			}

			fs.writeFile(filename, outputString, { flag: 'w' }, function(err) {
				if (err) {return console.error(err);}
				// read it back in to be sure it worked.
				fs.readFile(filename, 'utf-8', function(err) {
					if (err) {
						console.log('Reading file failed -- printing to console to ensure PK not lost');
						console.log(outputString);
					}
					console.log('PK File created', filename);
				});
			});
		}
		catch (err) {
			// If we fail to write it then spit out the values to command line so not lost
			console.log('Error writing file -- bailing', err);

			console.log(outputString);
			exit(1);
		}
	}
	else {
		console.log(outputString);
	}
}

main();
