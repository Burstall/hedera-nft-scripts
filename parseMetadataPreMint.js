const fs = require('fs');
const path = require('path');

const attribIndex = new Map();
const indexAttrib = new Map();

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node parseMetadataPreMint.js -parse <path/filename>');
		console.log('       -parse <path/filename> 		combined metadata file to parse');
		process.exit(0);
	}

	let fileToProcess;
	// get the file
	if (getArgFlag('parse')) {
		fileToProcess = path.resolve(getArg('parse'));
	}
	else {
		console.log('No file to parse specified - exiting');
	}
	const filename = path.basename(fileToProcess);

	let nftExportJSONString;
	// read in the file specified
	try {
		nftExportJSONString = fs.readFileSync(fileToProcess, 'utf8');
	}
	catch (err) {
		console.log(`ERROR: Could not read file (${fileToProcess})`, err);
		process.exit(1);
	}

	// parse file to build the attrib / property list
	// parse JSON
	let nftExportJSON;
	try {
		nftExportJSON = JSON.parse(nftExportJSONString);
	}
	catch (err) {
		console.log('ERROR: failed to parse the specified JSON', err, nftExportJSONString);
		process.exit(1);
	}

	let attIdx = -1;
	for (const n in nftExportJSON) {
		const nft = nftExportJSON[n];

		const attribs = nft.attributes;

		if (attribs) {
			for (const a in attribs) {
				const attribValue = attribs[a];
				const trait = attribValue.trait_type.toLowerCase();

				if (attribIndex.get(trait) == null) {
					attIdx++;
					attribIndex.set(trait, attIdx);
					indexAttrib.set(attIdx, trait);
				}
			}
		}


		const props = nft.properties;
		try {
			if (props) {
				props.forEach(async function(attribValue) {
					const isTrait = attribValue.trait_type;
					if (isTrait) {
						const trait = isTrait.toLowerCase();

						if (!attribIndex.get(trait)) {
							attIdx++;
							attribIndex.set(trait, attIdx);
							indexAttrib.set(attIdx, trait);
						}
					}
				});
			}
		}
		catch (err) {
			// swallow it as likely properties not set as an array.
		}
	}

	const delim = '\t';
	let outputStr = `name${delim}serial`;


	for (let idx = 0; idx < indexAttrib.size; idx++) {
		const trait = indexAttrib.get(idx);
		outputStr += `${delim}${trait}`;
	}


	for (const n in nftExportJSON) {
		const summaryAttribs = new Array(attribIndex.size).fill('N/A');

		const nft = nftExportJSON[n];

		const attribs = nft.attributes;

		if (attribs) {
			attribs.forEach(async function(attribValue) {
				const trait = attribValue.trait_type.toLowerCase();
				const traitValue = attribValue.value;

				summaryAttribs[attribIndex.get(trait)] = `${traitValue}`;

			});
		}

		const name = nft.name;
		const edition = nft.edition;

		let line = `\n${name}\t${edition}`;
		for (let i = 0; i < summaryAttribs.length; i++) {
			line += `\t${summaryAttribs[i]}`;
		}
		outputStr += line;
	}

	const startTime = new Date();
	const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
	fs.writeFile(`./${filename}-${timestamp}.tsv`, outputStr, () => {
		console.log(`${filename} metadata File created`);
	});

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
