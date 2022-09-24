require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	Mnemonic,
	Transaction,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
require('dotenv').config();

let publicKeyList = process.env.MULTI_SIG_PUBLIC_KEYS.split(',') || null;
let privateKeyList = process.env.MULTI_SIG_PRIVATE_KEYS.split(',') || null;
let multiSigThreshold = process.env.MULTI_SIG_THRESHOLD || null;

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

// read in from transaction bytes, add signature and export transaction bytes

// execute signed tx if signature list complete.

// update keys on an account based to convert to multi sig

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node updatePrivateKey.js [-generate] [-convert 0.0.XXXX [-threshold Y] [-publickeys \'MFC,BRV,GAS\']]');
		console.log('       			[-sign [-privatekeys \'302ABC,302QQA\'] [-bytes <TRANSACTIONBYTES as base64>]');
		console.log('       			[-query [-bytes <TRANSACTIONBYTES as base64>]');
		console.log('       -query 			displays tx details of MULTI_SIG_BYTES or overide on commandline with -bytes');
		console.log('       -generate 		create a new public / private keypair');
		console.log('       -threshold 		overide threshold (e.g. 2 of X public keys) else env MULTI_SIG_THRESHOLD');
		console.log('       -publickeys 	overide public keys (as csv) else env MULTI_SIG_PUBLIC_KEYS');
		console.log('       -privatekeys 	overide private key(s) as csv else env MULTI_SIG_PRIVATE_KEYS');
		process.exit(0);
	}

	const isQuery = getArgFlag('query');

	if (getArgFlag('sign') || isQuery) {
		let txBytesAsBase64 = process.env.MULTI_SIG_BYTES;
		if (getArgFlag('bytes')) txBytesAsBase64 = getArg('bytes');

		if (!txBytesAsBase64) {
			console.log('No tx supplied ot query - exiting');
			return;
		}

		console.log('\n-Decoding...');

		const txAsBytes = Uint8Array.from(Buffer.from(txBytesAsBase64, 'base64'));

		console.log('\n-Reconstructing transaction...');

		const tx = Transaction.fromBytes(txAsBytes);

		console.log(JSON.stringify(tx));

		console.log('\n* memo: ' + tx._transactionMemo +
			'\n* maxTxFee: ' + new Hbar(tx._maxTransactionFee._valueInTinybar, HbarUnit.Tinybar).toString() +
			'\n* proposed hbar tx: ' + await getHbarTransfers(tx));

		if (isQuery) return;

		const sign = readlineSync.keyInYNStrict('Do you want to sign the proposed tx?');

		if (sign) {
			let pkListArg = process.env.MULTI_SIG_PRIVATE_KEYS;
			// not recomended but adding for flexibility
			if (getArgFlag('privatekeys')) pkListArg = getArg('privatekeys');
			const pkStringList = pkListArg.split(',');
			if (pkStringList.length == 0) {
				console.log('No private keys supplied - exiting');
				return;
			}

			let signedStr = '';
			for (let k = 0; k < pkStringList.length; k++) {
				const pk = PrivateKey.fromString(pkStringList[k]);
				const signedTx = await tx.sign(pk);
				const signedTxAsBytes = signedTx.toBytes();
				const signedTxBytesAsBase64 = Buffer.from(signedTxAsBytes).toString('base64');
				signedStr += k > 0 ? ',' : '';
				signedStr += pk.publicKey + ':' + signedTxBytesAsBase64;
			}

			console.log('\n\n*Signed*\n\n' +
				'-------Copy between lines-------\n' +
				signedStr +
				'\n-------Copy between lines-------');
		}
		else {
			console.log('User aborted');
			return;
		}
	}
	else if (getArgFlag('generate')) {
		console.log('Generating new keys...');
		// Generate New key
		const mnemonic = await Mnemonic.generate();
		const newPrivateKey = await mnemonic.toPrivateKey();

		const outputString = 'Mnemonic:\n'
			+ mnemonic.toString()
			+ '\nNew Private Key:\n'
			+ newPrivateKey.toString()
			+ '\nNew Public Key:\n'
			+ newPrivateKey.publicKey
			+ '\n\nNew mnemonic:\n'
			+ mnemonic;

		const save = readlineSync.keyInYNStrict('Do you want to save your new generated keys to file?\n**HIGHLY RECOMMENDED as if lost the wallet could become inaccessible**');

		if (save) {
			const startTime = new Date();
			const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
			const filename = `./PK-${timestamp}.txt`;
			fs.writeFileSync(filename, outputString, { flag: 'w' }, function(err) {
				if (err) {
					console.log('ERROR occured - printing to console:\n', outputString);
					return console.error(err);
				}
				// read it back in to be sure it worked.
				fs.readFile(filename, 'utf-8', function(err) {
					if (err) {
						console.log('ERROR reading back the file - printing to console:\n', outputString);
						return console.error(err);
					}
					console.log('Keys saved', filename);
				});
			});
		}
		else {
			console.log(outputString);
		}
	}
	else {
		console.log('No eligible arguments supplied - please check usage ruinning the command with a -h switch');
	}
}

/**
 * Encapsulation of transaction processing to get hbar movements
 * @param {Transaction} tx
 */
async function getHbarTransfers(tx) {
	let outputStr = '';

	const hbarTransfers = tx._hbarTransfers;
	for (const t in hbarTransfers) {
		const hbarTransfer = hbarTransfers[t];
		outputStr += '\n\t' + hbarTransfer.accountId.toString() + '\t->\t' + new Hbar(hbarTransfer.amount._valueInTinybar, HbarUnit.Tinybar).toString();
	}

	return outputStr ? outputStr : 'No Hbar transfers found';
}

main();