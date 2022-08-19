const fetch = require('cross-fetch');
const fs = require('fs');

const tokenFlatFileDB = [];
let totalToProcess = 0;
const maxRetries = 8;
// const rps = 25;
const nftOwnerMap = new Map();
const tokenStatPromiseArray = [];
const delim = '\t';

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) {
		console.log('TIMED OUT: ', url);
		return null;
	}
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

async function getNFTList() {


	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = '/api/v1/tokens?limit=100';

	const nftList = [];

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}

		const tokens = json.tokens;

		for (let t = 0; t < tokens.length; t++) {
			if (tokens[t].type == 'NON_FUNGIBLE_UNIQUE') {
				nftList.push(tokens[t].token_id);
			}
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return nftList;
}

async function getTokenStats(tokenId) {

	const url = 'https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/' + tokenId;

	const json = await fetchJson(url);
	if (json == null) {
		console.log('ERROR processing: ', tokenId, url);
		return;
	}
	const tS = json.total_supply || 0;
	const mS = json.max_supply || 0;
	const symbol = json.symbol || '';
	const name = json.name || '';
	const tsryAcc = json.treasury_account_id;
	let royaltiesBool = 0;
	let fbfBool = 0;

	const customFees = json.custom_fees;
	let royaltiesStr = '';
	if (customFees.royalty_fees !== undefined) {

		const royalties = customFees.royalty_fees;
		royalties.forEach((item) => {
			const numerator = item.amount.numerator;
			const denom = item.amount.denominator || 0;
			let fallbackAmt;
			try {
				fallbackAmt = item.fallback_fee.amount / 100000000;
				fbfBool = 1;
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
			royaltiesStr += `amount ${percentage} - fallback ${fallbackAmt} - paid to ${item.collector_account_id || 'N/A'}`;
			royaltiesBool = 1;
		});

		if (!royaltiesBool) {royaltiesStr = 'NONE';}

	}
	else {
		royaltiesStr = 'NONE';
	}

	let supply = 0;
	if (tS > supply) {
		supply = tS;
	}
	else if (mS > supply) {
		supply = mS;
	}
	// insert the top level record into the database
	// tokenId
	// name
	// supply
	// maxSupply
	// royalties boolean
	// FBF boolean
	// Royalties
	// 		-> %
	// 		-> FBF
	// 		-> ID
	// symbol
	// treasury

	tokenFlatFileDB.push(`\n${tokenId}$${delim}${name}${delim}${supply}${delim}${mS}${delim}${royaltiesBool}${delim}${fbfBool}${delim}${royaltiesStr}${delim}${symbol}${delim}${tsryAcc}`);
}

async function getOwners(tokenId) {
	// get the tokens supply
	// no need to hold up the process but store the promises to block later
	tokenStatPromiseArray.push(getTokenStats(tokenId));
	// if supply == 0 then remove the limit
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = '/api/v1/tokens/' + tokenId + '/balances/?limit=100';

	// now get the owners
	// console.log(url);
	totalToProcess--;
	console.log(`Processing: ${tokenId} -> ${totalToProcess} remain...`);

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}

		const balances = json.balances;

		for (let b = 0; b < balances.length; b++) {
			const balItem = balances[b];
			const nftOwner = balItem.account;
			const balance = balItem.balance;
			// 2D array - total NFT / unique NFT
			const ownerObject = nftOwnerMap.get(nftOwner);
			let count;
			let uniqueCount;
			if (ownerObject === undefined) {
				count = 0;
				uniqueCount = 0;
			}
			else {
				count = ownerObject[0];
				uniqueCount = ownerObject[1];
			}

			if (balance > 0) { uniqueCount++; }

			nftOwnerMap.set(nftOwner, [count + balance, uniqueCount]);

		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

}


async function main() {
	// find list of NFTs

	const nftList = await getNFTList();
	console.log(`found ${nftList.length} NFTs (ignoring serial numbers)`);
	totalToProcess = nftList.length;

	/*
	const promiseArray = [];
	for (let i = 0; i < nftList.length; i++) {
		promiseArray.push(getOwners(nftList[i]));
		if (i % rps == 0) await sleep(1000);
	}

	await Promise.all(promiseArray);
	*/

	for (let i = 0; i < nftList.length; i++) {
		await getOwners(nftList[i]);
	}

	// same size and descending order
	const thresholds = [1, 2, 5, 100, 500, 1000];
	const counts = [0, 0, 0, 0, 0, 0];

	let count = 0;
	let countZero = 0;


	let csvOutput = '';


	nftOwnerMap.forEach(function(value, key) {
		const totalBalance = value[0];
		const uniqueCount = value[1];
		count++;
		csvOutput = csvOutput + `${key},${totalBalance},${uniqueCount}\n`;
		console.log(key, totalBalance);
		if (totalBalance == 0) {
			countZero++;
			return;
		}

		for (let i = 0; i < thresholds.length; i++) {
			if (totalBalance >= thresholds[i]) {
				counts[i]++;
			}
			else {
				return;
			}
		}

	});

	console.log(`Total accounts owning an NFT: ${count - countZero}`);
	for (let i = 0; i < thresholds.length; i++) {
		console.log(`Total accounts owning >= ${thresholds[i]} an NFT: ${counts[i]}`);
	}
	console.log(`Total accounts owning no longer owning an NFT: ${countZero}`);


	fs.writeFile('./walletOwnership.csv', csvOutput, () => {
		console.log('Wallet File created');
	});

	let tokenOutput = `tokenId${delim}name${delim}supply${delim}mS${delim}royaltiesBool${delim}fbfBool${delim}royaltiesStr${delim}symbol${delim}treasuryId`;
	for (let i = 0; i < tokenFlatFileDB.length; i++) {
		tokenOutput += tokenFlatFileDB[i];
	}


	fs.writeFile('./tokenFlatFileDB.tsv', tokenOutput, () => {
		console.log('token DB File created');
	});

}

main();
