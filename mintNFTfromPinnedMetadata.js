require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenMintTransaction,
} = require('@hashgraph/sdk');
const fetch = require('cross-fetch');
const readlineSync = require('readline-sync');
const fs = require('fs');

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';
const maxRetries = 10;

// Configure accounts and client, and generate needed keys
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const supplyKey = PrivateKey.fromString(process.env.NFT_SUPPLY_KEY);
const nftBatchSize = Number(process.env.NFT_MINT_BATCH_SIZE) || 10;
const env = process.env.ENVIRONMENT ?? null;


async function getTokenSupplyDetails(tokenId) {
	const baseUrl = env == 'MAIN' ? baseUrlForMainnet : baseUrlForTestnet;

	const routeUrl = '/api/v1/tokens/' + tokenId;

	try {
		const json = await fetchJson(baseUrl + routeUrl);
		return [json.max_supply, json.total_supply];
	}
	catch (err) {
		console.log('Trying to get token supply details', baseUrl, routeUrl);
		console.error(err);
		process.exit(1);
	}
}

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	if (depth > (maxRetries / 2)) console.log('Attempt: ', depth, url);
	depth++;
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			await sleep(500 * depth);
			return await fetchJson(url, depth);
		}
		return res.json();
	}
	catch (err) {
		await sleep(500 * depth);
		return await fetchJson(url, depth);
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(resource, options = {}) {
	const { timeout = 30000 } = options;
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const response = await fetch(resource, {
		...options,
		signal: controller.signal,
	});
	clearTimeout(id);
	return response;
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

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node mintNFTfromPinnedMetadata.js -process <file>');
		console.log('       -process	json file to read in and process');
		console.log('		File format: \
			\n\t[ \
			\n\t\t"ipfs://XXXX/metadata.json", \
			\n\t\t"ipfs://YYYY/metadata.json", \
			\n\t\t"ipfs://ZZZZ/metadata.json"  \
			\n\t]\
			\nor (output format of this script)\n\
			\n\t{\
			\n\t\t"0": {\
			\n\t\t\t"cid": "ipfs://XXXX/metadata.json",\
			\n\t\t\t"minted": true,\
			\n\t\t\t"serial": "629"\
			\n\t\t},\
			\n\t\t"1": {\
			\n\t\t\t"cid": "ipfs://YYY/metadata.json",\
			\n\t\t\t"minted": false,\
			\n\t\t},\
			\n\t\t"2": {\
			\n\t\t\t"cid": "ipfs://ZZZZ/metadata.json",\
			\n\t\t}\
			\n\t}');
		process.exit(0);
	}

	const fileToProcess = getArg('process');

	if (!fileToProcess) {
		console.log('ERROR: must specifiy file to process - EXITING');
		process.exit(1);
	}

	// Create our connection to the Hedera network
	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('Proposing to mint tokens in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('Proposing to mint tokens in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	client.setMaxAttempts(30);
	client.setMaxNodeAttempts(2);
	client.setRequestTimeout(30000);

	// Get the token ID
	const tokenId = process.env.NFT_TOKEN_ID;

	if (!tokenId) {
		console.log('NFT_TOKEN_ID (in .env file) must be specified to use the script - exiting');
		process.exit(1);
	}

	// get max supply / current supply
	const [maxSupply, totSupply] = await getTokenSupplyDetails(tokenId);

	// parse file to see how many NFTs to mint
	let pinnedMetadataJSONString;
	// read in the file specified
	try {
		pinnedMetadataJSONString = fs.readFileSync(fileToProcess, 'utf8');
	}
	catch (err) {
		console.log(`ERROR: Could not read file (${fileToProcess})`, err);
		process.exit(1);
	}

	// parse JSON
	let pinnedMetadataObjFromFile;
	try {
		pinnedMetadataObjFromFile = JSON.parse(pinnedMetadataJSONString);
	}
	catch (err) {
		console.log('ERROR: failed to parse the specified JSON', err, pinnedMetadataJSONString);
		process.exit(1);
	}

	let plannedMint = 0;
	const pinnedMetadataObjFromFileLength = Object.keys(pinnedMetadataObjFromFile).length;
	const pinnedMetadataObj = {};
	for (let p = 0; p < pinnedMetadataObjFromFileLength; p++) {
		const pinCID = pinnedMetadataObjFromFile[p];
		if (!pinCID.cid) {
			// convert to functional format
			plannedMint++;
			pinnedMetadataObj[p] = {
				cid: pinCID,
				minted: false,
			};
		}
		else {
			if (!pinCID.minted) plannedMint++;
			// move the object accross
			pinnedMetadataObj[p] = pinCID;
		}
	}
	await writeProgress(fileToProcess, pinnedMetadataObj);

	// check enough space on token to mint
	if ((maxSupply - totSupply - plannedMint) >= 0) {
		console.log('Precheck passed - enough space on token to mint');
	}
	else {
		console.log('Not enough space on token to mint - please check file specified', `Max Supply: ${maxSupply}`, `Current Supply: ${totSupply}`, `Planned mint: ${plannedMint}`);
		process.exit(1);
	}

	// Log the token ID
	console.log(`- Minting additional supply on NFT with Token ID: ${tokenId} \n`);
	console.log(`- Using account: ${operatorId} to pay`);
	console.log('- Using ENIVRONMENT:', env);
	console.log('- Planning to mint:', plannedMint);
	console.log('- Using batch size:', nftBatchSize);

	const execute = readlineSync.keyInYNStrict('Do wish to execute the mint?');

	if (!execute) {
		console.log('User aborted');
		process.exit(0);
	}

	const elementListLength = Object.keys(pinnedMetadataObj).length;
	console.log('Using mint batch size of', nftBatchSize);
	for (let outer = 0; outer < elementListLength; outer += nftBatchSize) {
		const tokenMintTx = new TokenMintTransaction();
		const indexBeingProcessed = [];
		for (let inner = 0; (inner < nftBatchSize) && ((outer + inner) < elementListLength); inner++) {
			const pinCID = pinnedMetadataObj[outer + inner];
			// if element marked as minted then skip.
			if (pinCID.minted) continue;
			indexBeingProcessed.push(outer + inner);
			tokenMintTx.addMetadata(Buffer.from(pinCID.cid));
		}
		// assumes the account sending is treasury account
		tokenMintTx
			.setTokenId(tokenId)
			.setMaxTransactionFee(5)
			.freezeWith(client);

		// sign
		const signedTx = await tokenMintTx.sign(supplyKey);
		// submit
		try {
			console.log('- MINTING items ->', indexBeingProcessed);
			const tokenMintSubmit = await signedTx.execute(client);
			// check it worked
			const tokenMintRx = await tokenMintSubmit.getReceipt(client);
			console.log('Tx processed - status:', tokenMintRx.status.toString());
			if (tokenMintRx.status.toString() == 'SUCCESS') {
				// mark the JSON entries as success
				const mintedSerials = tokenMintRx.serials;
				let serialIdx = 0;
				console.log(`- Created NFT ${tokenId} with serial: ${mintedSerials}`);
				for (let i = 0; i < indexBeingProcessed.length; i++) {
					const idx = indexBeingProcessed[i];
					const cid = pinnedMetadataObj[idx].cid;
					pinnedMetadataObj[idx] = {
						cid: cid,
						minted: true,
						serial: mintedSerials[serialIdx].toString(),
					};
					serialIdx++;
				}
				// write back out the updated file
				await writeProgress(fileToProcess, pinnedMetadataObj);
			}
			else {
				// mark the attempted file for preprocessing
				for (let idx = 0; idx < indexBeingProcessed.length; idx++) {
					const cid = pinnedMetadataObj[idx].cid;
					pinnedMetadataObj[idx] = {
						cid: cid,
						minted: false,
					};
				}
				// write back out the updated file
				await writeProgress(fileToProcess, pinnedMetadataObj);
			}
		}
		catch (err) {
			console.log('Error occured executing tx:', err);
			// mark the attempted file for preprocessing
			for (let idx = 0; idx < indexBeingProcessed.length; idx++) {
				const cid = pinnedMetadataObj[idx].cid;
				pinnedMetadataObj[idx] = {
					cid: cid,
					minted: false,
				};
			}
			// write back out the updated file
			await writeProgress(fileToProcess, pinnedMetadataObj);
		}
	}
}

async function writeProgress(filename, pinnedMetadataObj) {
	// write back out the updated file
	const saveFilename = 'output_' + env + '_' + filename.replace(/^\.\\/, '');
	const outputStr = JSON.stringify(pinnedMetadataObj, null, 4);
	fs.writeFile(saveFilename, outputStr, { flag: 'w' }, function(err) {
		if (err) {return console.error(err);}
		// read it back in to be sure it worked.
		fs.readFile(saveFilename, 'utf-8', function(err) {
			if (err) {
				console.log(outputStr);
				return console.error(err);
			}
			console.log('Mints logged to DB file', saveFilename);
		});
	});
}

main();