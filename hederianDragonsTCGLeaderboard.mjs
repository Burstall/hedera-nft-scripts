import fetch from 'cross-fetch';

// exclude (or label?) community wallet
const excludedWallets = ['0.0.859990'];
const dragonsTCGTokenId = '0.0.1003996';
const zuseEscrow = '0.0.690356';
const hashGuildEscrow = '0.0.1007535';
const maxRetries = 10;
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

function getDragonFromSerial(serial) {
	const dragonIndex = ((serial - (serial % 10)) / 10) + 1;
	return 'Dragon' + dragonIndex;
}

async function getUniqueDragonTCGOwnershipMap() {

	const nftOwnerMap = new Map();

	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = `/api/v1/tokens/${dragonsTCGTokenId}/nfts/?limit=100`;
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
			const dragonName = getDragonFromSerial(serial);
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
	// get a map of owners per serial
	const nftOwnerMap = await getUniqueDragonTCGOwnershipMap();

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