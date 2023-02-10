const readlineSync = require('readline-sync');
require('dotenv').config();
const fs = require('fs');
const { filesFromPath } = require('files-from-path');
const path = require('path');

const filenameRegex = /(\D+)\d+\.json$/i;

/**
 * Helper function to handle command line arguments without any additional packages
 * @param {string} arg the argument to look for
 * @returns {string} the value specified for the argument
 */
function getArg(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customIndex > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customIndex + 1];
	}

	return customValue;
}

/**
 * Helper function to check if command line arguments exist
 * @param {string} arg the command line argument to look for
 * @returns {boolean}
 */
function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

/**
 * Used to expand the number of NFT metadata files in a directory
 * @param {string} fullpath
 * @param {number} qty
 * @returns {Object} an index of the files pinned in the process
 */
async function explodeNFTMetadataInDirectory(fullpath, qty) {
	const pinnedCIDs = {};
	// scan for files
	try {
		// const fullpath = path.resolve(directory);

		let maxFileIndex = 0;
		const filenameList = [];
		const metadataJSONStringList = [];
		// parse the async iterator once to get the filenames
		for await (const f of filesFromPath(fullpath)) {
			// strip to get just the name
			// TODO: test on windows
			const filename = f.name.split('/').slice(-1);
			filenameList.push(filename[0]);
			maxFileIndex++;
		}

		console.log('Found ' +
			filenameList.length +
			' file to process @\n', fullpath, filenameList);

		const proceed = readlineSync.keyInYNStrict('Do you want to expand from ' + maxFileIndex + ' to ' + qty + '?');

		if (proceed) {

			// read in the files
			for (const f in filenameList) {
				const filename = fullpath + '\\' + filenameList[f];
				try {
					const metadataJSONString = fs.readFileSync(filename, 'utf8');
					const metadataObj = JSON.parse(metadataJSONString);
					metadataObj.name = metadataObj.name.split('#')[0] + '#';
					metadataJSONStringList.push(metadataObj);
				}
				catch (err) {
					console.log(`ERROR: Could not read file (${filename})`, err);
					process.exit(1);
				}
			}

			for (let i = maxFileIndex; i < qty; i++) {
				maxFileIndex++;
				const offset = (maxFileIndex % metadataJSONStringList.length);
				// copy the last one
				const metadataObj = copy(metadataJSONStringList[offset]);
				// update the name
				metadataObj.name += maxFileIndex;
				const filename = fullpath + '/' + filenameList[offset].match(filenameRegex)[1] + maxFileIndex + '.json';
				// write the object out to file
				fs.writeFile(filename, JSON.stringify(metadataObj), { flag: 'w' }, function(err) {
					if (err) {return console.error(err);}
					// read it back in to be sure it worked.
					fs.readFile(filename, 'utf-8', function(err) {
						if (err) {
							console.log('Failed to write', metadataObj);
							return console.error(err);
						}
					});
				});
			}
		}
		else {
			console.log('User Aborted');
		}
	}
	catch (err) {
		console.log('ERROR in pinning process', err);
	}

	return pinnedCIDs;
}

function copy(mainObject) {
	const objectCopy = {};
	let key;
	for (key in mainObject) {
		objectCopy[key] = mainObject[key];
	}
	return objectCopy;
}

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node explodeNFTMetadata.js -dir <directory> -qty XX');
		console.log('       -dir <directory>	read all files in directory');
		console.log('       -qty XXXX			expand number of files in sequential number');
		process.exit(0);
	}

	if (getArgFlag('dir')) {
		if (getArgFlag('qty')) {
			const qty = getArg('qty');
			const directory = getArg('dir');
			const fullpath = path.resolve(directory);
			await explodeNFTMetadataInDirectory(fullpath, qty);
		}
		else {
			console.log('ERROR: no quantity specified');
		}
	}
	else {
		console.log('ERROR: no directory specified');
	}
}

main();