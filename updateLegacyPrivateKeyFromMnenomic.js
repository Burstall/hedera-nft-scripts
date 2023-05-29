const {
	Client,
	AccountUpdateTransaction,
	AccountId,
	Mnemonic,
	TransferTransaction,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
require('dotenv').config();
const readlineSync = require('readline-sync');

/**
 * If you get an error "Error: the index should not be pre-hardened"
 * Then dive into node_modules\@hashgraph\cryptography\lib\primitive\slip10.cjs
 * and remove the below from derive method
 * if (bip32.isHardenedIndex(index)) {
    throw new Error("the index should not be pre-hardened");
  }
 * Needed foir legacy key support
 */

async function main() {
	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node updateLegacyPrivateKeyFromMnenomic.js -key XXXX [-acc <account>] [-m <Mnemonic>] [-public] [-save [<file-name>]] [-test] [-sendCheck <wallet>]');
		console.log('       -key 		key type to use, if not swpecified displays the list of keys and exitsw');
		console.log('       -acc <account> 		supply account to reset on commandline');
		console.log('       	**If not supplied will look for UPDATE_ACCT in .env **');
		console.log('       -m <mnemonic> 	supply private key to reset on commandline \'word1 word2 ... word24 \'');
		console.log('       	**If not supplied will look for OLD_MNEMONIC in .env **');
		console.log('		-public 			display all public keys then exit');
		console.log('       -save 				use -save to save the *NEW* PK to file');
		console.log('       	**Supresses console output**');
		console.log('       -save <filename>	to specify the file to save to');
		console.log('       -test				run script without changing key');
		console.log('       	**Changing keys is scary - this lets you be double sure connfig looks right**');
		console.log('       -sendCheck <wallet>		send 1 tinybar to the wallet to verify the key is working');
		process.exit(0);
	}

	let mnemoicString;
	if (getArgFlag('m')) {
		mnemoicString = getArg('m');
	}
	else {
		mnemoicString = process.env.OLD_MNEMONIC;
	}

	let mnemoic;
	try {
		mnemoic = await Mnemonic.fromString(mnemoicString);
	}
	catch (err) {
		console.log('Error with mnemonic format', err);
		process.exit(1);
	}

	const keyMap = await getPrivateKeyList(mnemoic);

	if (getArgFlag('public')) {
		for (const [key, value] of keyMap) {
			if (key.includes('ECDSA')) {
				console.log(key + ' Public Key', value.publicKey.toString().split('302d300706052b8104000a032200')[1]);
			}
			else {
				console.log(key + ' Public Key', value.publicKey.toString().split('302a300506032b6570032100')[1]);
			}
		}
		process.exit(0);
	}

	const keyType = getArg('key');
	if (!keyType) {
		// get a dummy key list from dummy mnemonic
		const dummyMnemoicString = 'orphan stable similar puzzle bless volume quiz increase wife pumpkin front busy donor health bitter expose spice leave access mango tail month wash waste';
		const dummyMnemoic = await Mnemonic.fromString(dummyMnemoicString);
		const dummyKeyMap = await getPrivateKeyList(dummyMnemoic);
		console.log('No key type specified');
		console.log('Available key types are:');
		for (const [keyName] of dummyKeyMap) {
			console.log(keyName);
		}
		process.exit(1);
	}

	let acctToChange;

	if (getArgFlag('acc')) {
		acctToChange = getArg('acc');
	}
	else {
		acctToChange = process.env.UPDATE_ACCT;
	}

	if (!keyMap.has(keyType)) {
		console.log(`Key type ${keyType} not found`);
		console.log('Available key types are:');
		for (const [keyName] of keyMap) {
			console.log(keyName);
		}
		process.exit(1);
	}

	console.log(`Using Key Type: ${keyType}`);

	const operatorKey = keyMap.get(keyType);
	const env = process.env.ENVIRONMENT ?? null;

	// check the account / mnemonic are valid
	if (!acctToChange || !operatorKey) {
		console.log('Environment variables UPDATE_ACCT and OLD_MNEMONIC must be present -- or supplied on the comamnd line');
		process.exit(1);
	}
	else {
		console.log(`Using Account ${acctToChange} as payer account / account to change`);
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

	client.setOperator(acctToChange, operatorKey);

	// check if user wants to send a test transaction
	if (getArgFlag('sendCheck')) {
		const checkWallet = getArg('sendCheck');
		let accountForTest;
		try {
			accountForTest = AccountId.fromString(checkWallet);
		}
		catch (err) {
			console.log('Error with test account format', err);
		}

		console.log(`Sending 1 tinybar to ${accountForTest.toString()} to verify key is working`);
		const tx = new TransferTransaction()
			.addHbarTransfer(acctToChange, new Hbar(-1, HbarUnit.Tinybar))
			.addHbarTransfer(accountForTest, new Hbar(1, HbarUnit.Tinybar))
			.setTransactionMemo('Test Key Transaction')
			.freezeWith(client);

		const signedTx = await tx.sign(operatorKey);
		const transferSubmit = await signedTx.execute(client);
		const transferRx = await transferSubmit.getReceipt(client);
		console.log('Test was: ', transferRx.status.toString());
	}

	if (getArgFlag('test')) console.log('**TEST MODE ** NO KEYS WILL CHANGE **');

	// check if save to file requested
	let save = getArgFlag('save');
	// if so see if a filename was supplied
	let filename = getArg('save');

	// check if user wants to save the PK to file
	if (!save) {
		save = readlineSync.keyInYNStrict('Do you want to save your new generated keys to file?\n**HIGHLY RECOMMENDED as if lost the wallet is inaccessible**');
	}


	console.log('Generating new keys...');
	// Generate New key
	const mnemonic = await Mnemonic.generate();
	console.log('Generating new ED25519 key...');
	const newKey = await mnemonic.toStandardEd25519PrivateKey();

	// write the output first before changing the key

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

			fs.writeFileSync(filename, outputString, { flag: 'w' }, function(err) {
				if (err) {
					console.log('ERROR occured - printing to console:\n', outputString);
					return console.error(err);
				}
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
			process.exit(1);
		}
	}
	else {
		console.log(outputString);
	}

	if (!getArgFlag('test')) {
		const proceed = readlineSync.keyInYNStrict('Do you want to proceed with changing the key on the account? (Last chance to cancel!)');
		if (!proceed) {
			console.log('Aborting...');
			process.exit(1);
		}

		console.log('Updating account', acctToChange, 'with new Key...');
		// Create the transaction to update the key on the account
		const transaction = new AccountUpdateTransaction()
			.setAccountId(acctToChange)
			.setKey(newKey)
			.freezeWith(client);

		// Sign the transaction with the old key and new key
		const signTx = await (await transaction.sign(operatorKey)).sign(newKey);

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

}

// https://github.com/hashgraph/MyHbarWallet/blob/d0a66159de55d622071041a6b7e53712f98a684d/src/domain/wallet/software-mnemonic.ts


/**
   *
   * @param {Mnemonic} _mnemonic
   * @param {String} _password
   * @returns {Map} keyList
   */
async function getPrivateKeyList(_mnemonic, _password) {
	const keyList = new Map();

	try {
		const privateKey = await _mnemonic.toPrivateKey(_password);
		keyList.set('Root', privateKey);
	}
	catch (error) {
		console.warn(error);
	}

	try {
		const privateKey = await _mnemonic.toPrivateKey('null');
		keyList.set('Null', privateKey);
	}
	catch (error) {
		console.warn(error);
	}

	let rootPrivateKey = await _mnemonic.toPrivateKey(_password);
	if (rootPrivateKey != null) {
		if (rootPrivateKey.isDerivable()) {
			const privateKey = await rootPrivateKey.derive(0);
			keyList.set('RootDeriveZero', privateKey);
		}
	}

	if (rootPrivateKey != null) {
		if (rootPrivateKey.isDerivable()) {
			const privateKey = await rootPrivateKey.derive(-1);
			keyList.set('RootDeriveNeg1', privateKey);
		}
	}

	if (rootPrivateKey != null) {
		if (rootPrivateKey.isDerivable()) {
			const privateKey = await rootPrivateKey.derive(1099511627775);
			keyList.set('RootDerive0xffffffffff', privateKey);
		}
	}


	if (rootPrivateKey != null) {
		if (rootPrivateKey.isDerivable()) {
			const privateKey = await rootPrivateKey.derive(0);
			keyList.set('NullDeriveZero', privateKey);
		}
	}

	if (rootPrivateKey != null) {
		if (rootPrivateKey.isDerivable()) {
			const privateKey = await rootPrivateKey.derive(255);
			keyList.set('NullDerive255', privateKey);
		}
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(0);
		keyList.set('RootLegacyDeriveZero', privateKey);
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(-1);
		keyList.set('RootLegacyDeriveNeg1', privateKey);
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(1099511627775);
		keyList.set('RootLegacyDerive0xffffffffff', privateKey);
	}

	try {
		const privateKey = await _mnemonic.toLegacyPrivateKey();
		keyList.set('LegacyRoot', privateKey);
	}
	catch (error) {
		console.warn(error);
	}

	rootPrivateKey = await _mnemonic.toLegacyPrivateKey();
	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(0);
		keyList.set('LegacyRootDeriveZero', privateKey);
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(0);
		keyList.set('LegacyRootDeriveZeroZero', privateKey);
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(-1);
		keyList.set('LegacyRootDeriveNeg1', privateKey);
	}

	if (rootPrivateKey != null) {
		const privateKey = await rootPrivateKey.legacyDerive(1099511627775);
		keyList.set('LegacyRootDerive0xffffffffff', privateKey);
	}

	const ECDSALegacy = await _mnemonic.toEcdsaPrivateKey();
	keyList.set('ECDSALegacy', ECDSALegacy);

	const ECDSA = await _mnemonic.toStandardECDSAsecp256k1PrivateKey();
	keyList.set('ECDSA', ECDSA);

	return keyList;
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
