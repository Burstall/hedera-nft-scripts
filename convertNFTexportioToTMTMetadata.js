const fs = require('fs');
require('dotenv').config();

let website = process.env.COLLECTION_WEBSITE;
let compiler = process.env.COLLECTION_COMPILER;
let creator = process.env.COLLECTION_CREATOR;
let logoCID = 'ipfs://' + process.env.COLLECTION_LOGO;
let category = process.env.COLLECTION_CATEGORY;
let desc = process.env.COLLECTION_DESC;

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
	if (getArgFlag('h')) {
		console.log('Usage: node convertNFTexportioToTMTMetadata.js -process <file> [-website <url>] [-compiler <name>] [-creator <creator>] [-logo <CID>] [-category <category>][-desc \'description here\'');
		console.log('       -process	file to read in and process');
		console.log('       -website	project url - optional');
		console.log('       -compiler	compiler text - optional');
		console.log('       -creator	creator text - optional');
		console.log('       -logo	Pinned CID for a logo jpg image');
		console.log('       -category	category text - optional');
		console.log('       -desc	compiler text - optional');
		return;
	}

	const metadataDate = new Date();

	if (getArgFlag('website')) website = getArg('website');
	if (getArgFlag('compiler')) compiler = getArg('compiler');
	if (getArgFlag('creator')) creator = getArg('creator');
	if (getArgFlag('logo')) logoCID = 'ipfs://' + getArg('logo');
	if (getArgFlag('category')) category = getArg('category');
	if (getArgFlag('desc')) desc = getArg('desc');

	const fileToProcess = getArg('process');

	if (!fileToProcess) {
		console.log('Please specify the file to process - exiting');
		process.exit(1);
	}

	let nftExportJSONString;
	// read in the file specified
	try {
		nftExportJSONString = fs.readFileSync(fileToProcess, 'utf8');
	}
	catch (err) {
		console.log(`ERROR: Could not read file (${fileToProcess})`, err);
		process.exit(1);
	}

	// parse JSON
	let nftExportJSON;
	try {
		nftExportJSON = JSON.parse(nftExportJSONString);
	}
	catch (err) {
		console.log('ERROR: failed to parse the specified JSON', err, nftExportJSONString);
		process.exit(1);
	}

	const jsonArray = [];

	// rebuild the output
	const basename = nftExportJSON.name;

	for (const n in nftExportJSON.collection) {
		const nft = nftExportJSON.collection[n];
		const hederaFormatNFT = {};
		hederaFormatNFT.creator = creator;
		hederaFormatNFT.category = category;
		hederaFormatNFT.name = basename + ' #' + nft.name;
		hederaFormatNFT.description = desc;
		hederaFormatNFT.image = 'placeholder - replaced by pinned CID during mint';
		hederaFormatNFT.date = Number(metadataDate);
		hederaFormatNFT.edition = Number(nft.name);

		// add the attributes
		hederaFormatNFT.attributes = [];
		for (const a in nft.attributes) {
			const attrib = nft.attributes[a];
			hederaFormatNFT.attributes.push(attrib);
		}

		hederaFormatNFT.files = [];
		const logoObj = {};
		logoObj.name = 'Logo';
		logoObj.description = 'Collection Logo';
		logoObj.uri = logoCID;
		logoObj.type = 'image/jpg';
		hederaFormatNFT.files.push(logoObj);
		hederaFormatNFT.website = website;
		hederaFormatNFT.compiler = compiler;

		jsonArray.push(hederaFormatNFT);
	}

	// write the file

	const saveFilename = 'hederaFormat_' + fileToProcess.replace(/^\.\\/, '');
	fs.writeFile(saveFilename, JSON.stringify(jsonArray, null, 4), { flag: 'w' }, function(err) {
		if (err) {return console.error(err);}
		// read it back in to be sure it worked.
		fs.readFile(saveFilename, 'utf-8', function(err, data) {
			if (err) {
				console.log(jsonArray);
				return console.error(err);
			}
			console.log('new format file written', saveFilename, data);
		});
	});
}

main();