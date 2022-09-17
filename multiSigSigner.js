require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	Mnemonic,
} = require('@hashgraph/sdk');
const fs = require('fs');
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

// read in from transaction bytes, add signature and export transaction bytes

// execute signed tx if signature list complete.

// update keys on an account based to convert to multi sig

async function main() {
	if (getArg('h')) {
		console.log('Usage: node updatePrivateKey.js [-generate]');
		console.log('       -generate 		create a new public / private keypair');
		process.exit(0);
	}

	if (getArgFlag('generate')) {
		console.log('Generating new keys...');
		// Generate New key
		const mnemonic = await Mnemonic.generate();
		const newPrivateKey = await mnemonic.toPrivateKey();

		const outputString = 'Mnemonic:\n'
			+ mnemonic.toString()
			+ '\nNew Private Key:\n'
			+ newPrivateKey.toString()
			+ '\nNew Public Key:\n'
			+ newPrivateKey.publicKey;

		const save = readlineSync.keyInYNStrict('Do you want to save your new generated keys to file?\n**HIGHLY RECOMMENDED as if lost the wallet could become inaccessible**');

		if (save) {

			const startTime = new Date();
			const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
			const filename = `./PK-${timestamp}.txt`;
			fs.writeFile(filename, outputString, function(err) {
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
					console.log('Transfers logged to DB file', filename);
				});
			});
		}
		else {
			console.log(outputString);
		}

		process.exit(0);
	}
}

main();