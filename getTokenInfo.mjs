import fetch from 'cross-fetch';

let swapLineBreak = false;
let verbose = false;
let testnet = false;
let serialsCheck = false;
let imgOnly = false;

// global variable
const ipfsGateways = ['https://ipfs.eth.aragon.network/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://ipfs.eternum.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'];

const maxRetries = 5;

async function fetchJson(url, depth = 0, retries = maxRetries) {
	if (depth >= retries) return null;
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

async function fetchIPFSJson(ifpsUrl, depth = 0, seed = 0) {
	if (depth >= maxRetries) return null;
	if (depth > 0 && verbose) console.log('Attempt: ', depth + 1);
	depth++;

	const url = `${ipfsGateways[seed % ipfsGateways.length]}${ifpsUrl}`;
	if (verbose) {console.log('Fetch: ', url, depth);}
	seed += 1;
	try {
		const res = await fetch(url);
		if (res.status != 200) {
			await sleep(12 * depth * seed % 100);
			return await fetchIPFSJson(ifpsUrl, depth, seed);
		}
		return res.json();

	}
	catch (err) {
		console.error('Caught error when accessing', depth, url, err);
		await sleep(12 * depth * seed % 100);
		return await fetchIPFSJson(ifpsUrl, depth, seed);
	}
}

async function getTokenInfo(tokenId, serialsList) {
	let url;
	if (testnet) {
		url = `https://testnet.mirrornode.hedera.com/api/v1/tokens/${tokenId}`;
	}
	else {
		url = `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${tokenId}`;
	}
	if (verbose) { console.log(url); }

	const token = await fetchJson(url, 0, 2);
	if (token == null) {
		console.log(`Error looking up ID: ${tokenId}`);
		return null;
	}

	// console.log(Inspect.properties(u));
	const customFees = token.custom_fees;
	// console.log(customFees);
	let royaltiesStr = '';
	if (customFees.royalty_fees !== undefined) {
		// console.log(customFees);
		const royalties = customFees.royalty_fees;
		royalties.forEach((item) => {
			const numerator = item.amount.numerator;
			const denom = item.amount.denominator || 0;
			let fallbackAmt;
			try {
				fallbackAmt = item.fallback_fee.amount / 100000000;
			}
			catch (error) {
				fallbackAmt = 'N/A';
			}
			let percentage;
			if (denom == 0) {
				percentage = 'N/A';
			}
			else {
				percentage = `${numerator / denom * 100}%`;
			}
			royaltiesStr += ` amount ${percentage}, fallback ${fallbackAmt}, paid to ${item.collector_account_id || 'N/A'}`;
		});

	}
	else {
		royaltiesStr = 'NONE';
	}
	if (verbose) console.log(royaltiesStr);

	const tS = token.total_supply;
	const mS = token.max_supply;
	const type = token.type;
	let symbol = token.symbol;
	const name = token.name;
	const decimals = token.decimals;
	const tsryAcc = token.treasury_account_id;
	const deleted = token.deleted;
	const pause = token.pause_status;
	const supply_type = token.supply_type;

	// check if metadata in the symbol
	if (symbol.includes('IPFS')) {
		symbol = await getMetadata(symbol);
	}
	console.log(url);
	console.log(`token: ${tokenId}, total supply: ${tS}`);
	console.log(`name: ${name}, decimal: ${decimals}`);
	console.log(`symbol: ${symbol}`);
	console.log(`tsry: ${tsryAcc}, max supply: ${mS}`);
	console.log(`type: ${type}, supply type: ${supply_type}`);
	console.log(`deleted: ${deleted}, pause: ${pause}`);
	console.log(royaltiesStr);

	if (serialsCheck) {
		for (let c = 0; c < serialsList.length; c++) {
			const result = await getNFTSerialMetadata(`${url}/nfts/${serialsList[c]}`, serialsList[c]);
			console.log(`Serial #${serialsList[c]}`, result);
		}
	}
}

async function getNFTSerialMetadata(url) {
	if (verbose) { console.log(url); }

	const u = await fetchJson(url);

	const metadataString = atob(u.metadata);
	if (verbose) { console.log('translated metadata string: ', metadataString); }

	const ipfsRegEx = /ipfs:?\/\/?(.+)/i;
	let ipfsString;
	try {
		ipfsString = metadataString.match(ipfsRegEx)[1];
	}
	catch (_err) {
		// likely string did not have IPFS in it...default use the whole string
		ipfsString = metadataString;
	}
	if (verbose) { console.log('regexed metadata string: ', ipfsString); }

	const metadataJSON = await fetchIPFSJson(ipfsString, 0, randomNumber(0, ipfsGateways.length));

	const name = metadataJSON.name;

	let desc = metadataJSON.description;

	let img = metadataJSON.image;

	try {
		if (verbose) console.log('IMG:', img);
		if (img.description) {
			img = img.description;
		}
		img = img.replace(/ipfs:\/\//gi, `${ipfsGateways[0]}`);
	}
	catch (err) {
		console.log('error obtaining the image', img, err);
	}

	let attribs = '';
	try {
		metadataJSON.attributes.forEach((item) => {
			attribs += `\n${item.trait_type} = ${item.value}`;
		});
	}
	catch {
		// if no attributes
		attribs = 'NONE';
	}


	if (swapLineBreak) {
		desc = desc.replace(/ \/ /gi, '\n');
	}
	if (imgOnly) {
		return ` - ${img}`;
	}
	else {
		return `\nName: ${name}\nDESC: ${desc} \nCreator: ${metadataJSON.creator} Compiler: ${metadataJSON.compiler}\nIMG: ${img}\nAttribs: ${attribs}`;
	}

}

function randomNumber(min, max) {
	return Math.floor(Math.random() * (max - min) + min);
}

async function getMetadata(path) {
	const splitURI = path.split('/');

	const ifpsString = splitURI[splitURI.length - 1];

	const metadataJSON = await fetchIPFSJson(ifpsString, 0, randomNumber(0, ipfsGateways.length));

	let desc = metadataJSON.description.description;

	if (swapLineBreak) {
		desc = desc.replace(/ \/ /gi, '\n');
	}

	return `\nDESC: ${desc} \nIMG: ${metadataJSON.image.description}`;

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

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchWithTimeout(resource, options = {}) {
	const { timeout = 5000 } = options;

	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const response = await fetch(resource, {
		...options,
		signal: controller.signal,
	});
	clearTimeout(id);
	return response;
}

async function main() {


	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node getTokenInfo.mjs -t <token> [-v] [-swap] [-testnet] [-s <serial>] [-img]');
		console.log('       -t <token>');
		console.log('       -s <serial>');
		console.log('       -img    gets images only');
		console.log('       -swap   swaps out line breaks in metadata found');
		console.log('       -testnet');
		console.log('       -v          verbose [debug]');
		return;
	}

	verbose = getArgFlag('v');

	let tokenId = getArg('t');
	if (tokenId === undefined) {
		console.log('**MUST** specify token -> Usage: node getTokenInfo.mjs -h');
		return;
	}

	swapLineBreak = getArgFlag('swap');

	testnet = getArgFlag('testnet');

	imgOnly = getArgFlag('img');

	const serialsArg = getArg('s');
	let serialsList = [];

	if (serialsArg !== undefined) {
		serialsCheck = true;

		// format csv or '-' for range
		if (serialsArg.includes('-')) {
			// inclusive range
			const rangeSplit = serialsArg.split('-');
			for (let i = rangeSplit[0]; i <= rangeSplit[1]; i++) {
				serialsList.push(`${i}`);
			}
		}
		else if (serialsArg.includes(',')) {
			serialsList = serialsArg.split(',');
		}
		else {
			// only one serial to check
			serialsList = [serialsArg];
		}

	}

	const tokenList = [tokenId];

	for (let i = 0; i < tokenList.length; i++) {

		tokenId = tokenList[i];
		if (verbose) {console.log(`processing token: ${tokenId}`);}
		await getTokenInfo(tokenId, serialsList);

	}

}

main();
