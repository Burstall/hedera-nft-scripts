// const readlineSync = require('readline-sync');
require('dotenv').config();
const fs = require('fs');
const { NFTStorage, File } = require('nft.storage');
const { filesFromPath } = require('files-from-path');
const mime = require('mime');
const path = require('path');

let NFT_STORAGE_KEY = process.env.NFT_STORAGE_KEY || null;

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
  * Pass in the NFT metadata object and the path to the image for pinning
  * @param {string} imagePath the path to an image file
  * @param {string} metadata metadata object
  */
async function pinNFTMetadata(imagePath, metadata) {
	// load the file from disk
	const image = await getFileFromPath(imagePath);

	// create a new NFTStorage client using our API key
	const nftstorage = new NFTStorage({ token: NFT_STORAGE_KEY });

	return nftstorage.store({
		...metadata,
		image: image,
		type: image.type,
	});
}

/**
  * A helper to read a file from a location on disk and return a File object.
  * Note that this reads the entire file into memory and should not be used for
  * very large files.
  * @param {string} filePath the path to a file to store
  * @returns {File} a File object containing the file content
  */
async function getFileFromPath(filePath) {
	const content = await fs.promises.readFile(filePath);
	const type = mime.getType(filePath);
	return new File([content], path.basename(filePath), { type });
}

/**
 * Used to pin an entire directory to IPFS
 * @param {string} fullpath the resolved path of the directory being uploaded
 * @returns {Object} an index of the files pinned in the process
 */
async function pinDirectory(fullpath) {
	const pinnedCIDs = {};
	// scan for files
	try {
		// const fullpath = path.resolve(directory);

		const filenameList = [];
		// parse the async iterator once to get the filenames
		for await (const f of filesFromPath(fullpath)) {
			// strip to get just the name
			// TODO: test on windows
			const filename = f.name.split('/').slice(-1);
			filenameList.push(filename[0]);
		}

		console.log('Found ' +
			filenameList.length +
			' file to process @\n', fullpath, filenameList);

		const files = filesFromPath(fullpath, {
			pathPrefix: fullpath,
		});


		const nftStorageClient = new NFTStorage({ token: NFT_STORAGE_KEY });

		const cid = await nftStorageClient.storeDirectory(files);
		console.log('Pinned at: ipfs://' + cid);

		pinnedCIDs[fullpath] = [];
		for (const f in filenameList) {
			const filename = filenameList[f];
			pinnedCIDs[fullpath].push({
				file: filename,
				cid: 'ipfs://' + cid + '/' + filename });
		}
	}
	catch (err) {
		console.log('ERROR in pinning process', err);
	}

	return pinnedCIDs;
}

async function writeOutput(filename, outputString) {
	// if no filename supllied use default
	const startTime = new Date();
	const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
	if (!filename) {
		filename = `./pinnedCIDs-${timestamp}.json`;
	}
	else {
		filename = `./${filename}-pinnedCIDs-${timestamp}.json`;
	}

	fs.writeFile(filename, outputString, { flag: 'w' }, function(err) {
		if (err) { return console.error(err); }
		// read it back in to be sure it worked.
		fs.readFile(filename, 'utf-8', function(err) {
			if (err) {
				console.log('Reading file failed -- printing to console to ensure data not lost');
				console.log(outputString);
			}
			console.log('pinned CIDs File created', filename);
		});
	});
}

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node pinToIPFS.js [-dir <directory>] [-storagekey XXX]');
		console.log('       -dir <directory>	read all files in directory and pin them to IPFS output JSON of name/CID');
		console.log('       -storagekey XXXX	overide the NFT.Storage API key on command line instead of .env');
		process.exit(0);
	}

	if (getArgFlag('storagekey')) {
		NFT_STORAGE_KEY = getArg('storagekey');
	}

	if (!NFT_STORAGE_KEY) {
		console.log('FATAL ERROR: NFT.Storage key must be specified');
		process.exit(1);
	}

	if (getArgFlag('dir')) {
		const directory = getArg('dir');
		const fullpath = path.resolve(directory);
		const pinnedCIDObj = await pinDirectory(fullpath);
		const filename = path.basename(fullpath);
		await writeOutput(filename, JSON.stringify(pinnedCIDObj, null, 4));
	}
}

main();