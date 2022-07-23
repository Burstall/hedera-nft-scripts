import fetch from 'cross-fetch';

// exclude (or label?) community wallet
const excludedWallets = ['0.0.859990'];
const dragonsTCGTokenId = '0.0.1003996';
const dragonsNPCTokenId = '0.0.1057949';
const zuseEscrow = '0.0.690356';
const hashGuildEscrow = '0.0.1007535';
const maxRetries = 20;
const ipfsGateways = ['https://cloudflare-ipfs.com/ipfs/', 'https://ipfs.eth.aragon.network/ipfs/', 'https://ipfs.io/ipfs/', 'https://ipfs.eternum.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'];
const serialNameMap = new Map();
let totalCompleted = 0;
let verbose;

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
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

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSerialNFTAttribs(tokenId) {
	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = `/api/v1/tokens/${tokenId}/nfts/?limit=100`;
	if (verbose) { console.log(baseUrl + routeUrl);}

	const promisesList = [];

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const nfts = json.nfts;

		for (let n = 0; n < nfts.length; n++) {
			promisesList.push(processNFT(nfts[n]));
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	const responseData = await Promise.all(promisesList);
	for (let r = 0; r < responseData.length; r++) {
		try {
			if (responseData[r] === undefined) continue;
			serialNameMap.set(responseData[r][0], responseData[r][1]);
		}
		catch (err) {
			console.log(`ERROR: element ${r} -> ${responseData[r]}`);
		}
	}
}

async function fetchIPFSJson(ifpsUrl, depth = 0, seed = 0) {
	if (depth >= maxRetries) return null;
	if (depth > 15) console.log('Attempt: ', depth);
	depth = depth + 1;

	const url = `${ipfsGateways[seed % ipfsGateways.length]}${ifpsUrl}`;
	if (verbose) {console.log('Fetch: ', url, depth);}
	seed += 1;
	const sleepTime = ((12 * depth ^ 2 * seed) % 100) * (depth % 5);
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			await sleep(sleepTime);
			return await fetchIPFSJson(ifpsUrl, depth, seed);
		}
		return res.json();

	}
	catch (err) {
		if (depth > 8) {
			if (verbose) {console.error('Caught error when accessing', depth, seed, url, `sleeping for ${sleepTime + 125 * depth}`);}
			await sleep(sleepTime + 225 * depth);
		}
		else {
			await sleep(sleepTime + 30 * depth);
		}
		return await fetchIPFSJson(ifpsUrl, depth, seed);
	}
}

async function processNFT(nft) {

	const serialNum = nft.serial_number;

	const deleted = nft.deleted;
	if (deleted) {
		console.log(serialNum, 'is deleted - skipping');
		return;
	}

	await sleep(21 * serialNum % 1000);

	const metadataString = atob(nft.metadata);

	const ipfsRegEx = /ipfs:?\/\/?(.+)/i;
	let ipfsString;
	try {
		ipfsString = metadataString.match(ipfsRegEx)[1];
	}
	catch (_err) {
		// likely string did not have IPFS in it...default use the whole string
		ipfsString = metadataString;
	}

	const metadataJSON = await fetchIPFSJson(ipfsString, 0, serialNum);

	const name = metadataJSON.name;

	totalCompleted++;
	console.log(`complete: ${serialNum} / ${name} -> now total complete: ${totalCompleted}`);

	return [serialNum, name];
}

function getDragonFromSerial(tokenId, serial) {
	switch (tokenId) {
	case dragonsTCGTokenId:
		return 'Dragon' + ((serial - (serial % 10)) / 10) + 1;
	case dragonsNPCTokenId:
		/*
		 * Removing hard coding look up to Web 3.0 equiv
		 *
		if (serial <= 200) return 'Deliriovirus';
		else if (serial <= 400) return 'Emezri Blowgun';
		else if (serial <= 500) return 'Omnikey';
		else if (serial <= 700) return 'Swevenberry';
		else if (serial <= 800) return 'Sacrifice';
		else return 'UKNOWN';
		*/
		return serialNameMap.get(serial) || 'UNKNOWN';
	default:
		console.log(`Unknown classification for ${tokenId}/#${serial}`);
	}
}

async function getUniqueDragonTCGOwnershipMap(tokenId, nftOwnerMap = new Map()) {

	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = `/api/v1/tokens/${tokenId}/nfts/?limit=100`;
	if (verbose) { console.log(baseUrl + routeUrl);}
	let batch = 0;
	do {
		batch++;
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const nfts = json.nfts;

		for (let n = 0; n < nfts.length; n++) {
			if (verbose) console.log(`Batch ${batch} - Processing item:', ${n}, 'of', ${nfts.length}`);
			const value = nfts[n];
			const serial = value.serial_number;


			if (value.deleted) continue;
			const nftOwner = value.account_id;
			if (excludedWallets.includes(nftOwner) || nftOwner == zuseEscrow || nftOwner == hashGuildEscrow) {
				continue;
			}
			const dragonName = getDragonFromSerial(tokenId, serial);
			const ownerDragonList = nftOwnerMap.get(nftOwner) || [];
			if (!ownerDragonList.includes(dragonName)) {
				ownerDragonList.push(dragonName);
				nftOwnerMap.set(nftOwner, ownerDragonList);
			}
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);


	return nftOwnerMap;
}

async function main() {
	verbose = false;
	// parse token for serial / name pairing [on non dragon TC tokens]
	console.log('Processing non-dragon card metadata...');
	await getSerialNFTAttribs(dragonsNPCTokenId);
	console.log('**COMPLETE**');
	// get a map of owners per serial
	console.log('Parsing ownership of Dragon TCs');
	let nftOwnerMap = await getUniqueDragonTCGOwnershipMap(dragonsTCGTokenId);
	console.log('Parsing ownership of non-dragon TCs');
	nftOwnerMap = await getUniqueDragonTCGOwnershipMap(dragonsNPCTokenId, nftOwnerMap);
	console.log('**COMPLETE**');

	console.log('Preparing Leaderboard');
	const nftOwnerList = [];
	nftOwnerMap.forEach((value, key) => {
		nftOwnerList.push([key, value.length]);
	});

	const sortedList = nftOwnerList.sort((a, b) => {
		if (a[1] == b[1]) {
			return a[0] - b[0];
		}
		return b[1] - a[1];
	});

	console.log('LEADERBOARD\nRank\tWallet\t\tUnique Owned');
	for (let w = 0; w < sortedList.length; w++) {
		console.log(`${w + 1}\t${nftOwnerList[w][0]}\t\t${nftOwnerList[w][1]}`);
	}
}

main();