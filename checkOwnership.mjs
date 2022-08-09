import fetch from 'cross-fetch';
import * as fs from 'fs';

const maxRetries = 10;
const zuseEscrow = '0.0.690356';
const hashGuildEscrow = '0.0.1007535';
const zuseLaunchpad = '0.0.705448';
const hashAxisMint = '0.0.580000';

const version = '0.2.6';

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

async function getTokenDetails(tokenId, verbose) {
	const returnArray = [];
	const url = `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${tokenId}`;
	if (verbose) { console.log(url); }

	const u = await fetchJson(url);

	const tS = u.total_supply;
	const mS = u.max_supply;
	const type = u.type;
	const symbol = u.symbol || '';
	const name = u.name || '';
	const decimals = u.decimals || 0;
	const tsryAcc = u.treasury_account_id;
	const customFees = u.custom_fees;

	let royaltiesStr = '';
	if (customFees.royalty_fees) {
		if (verbose) console.log(JSON.stringify(customFees, 4));
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
			royaltiesStr += `amount ${percentage}, fallback ${fallbackAmt}, paid to ${item.collector_account_id || 'N/A'}`;
		});

	}
	else {
		royaltiesStr = 'NONE';
	}


	let supply = 0;
	if (tS > supply) {
		supply = tS;
	}
	else if (u.supply_type == 'INFINITE') {
		supply = 50000;
	}
	else {
		supply = mS;
	}
	// supply no longer used however kept in place for array ordering
	// TODO: refactor as a Map
	returnArray.push(supply);
	returnArray.push(type);
	returnArray.push(symbol);
	returnArray.push(name);
	returnArray.push(decimals);
	returnArray.push(royaltiesStr);
	returnArray.push(tsryAcc);

	return returnArray;

}


async function getSerialNFTOwnership(tokenId, walletId = null, name, serialsList, royaltiesStr, tsryAcc, excludeList, verbose) {
	const nftOwnerMap = new Map();

	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl;
	if (walletId) {
		routeUrl = '/api/v1/tokens/' + tokenId + '/nfts?account.id=' + walletId;
	}
	else {
		routeUrl = `/api/v1/tokens/${tokenId}/nfts/?limit=100`;
	}
	if (verbose) { console.log(baseUrl + routeUrl);}

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const nfts = json.nfts;

		for (let n = 0; n < nfts.length; n++) {
			const value = nfts[n];
			if (serialsList.length > 0) {
				if (!serialsList.includes(`${value.serial_number}`)) {
					continue;
				}
			}
			// check if serial is deleted
			if (value.deleted) continue;
			const spender = value.spender;

			const nftOwner = value.account_id;
			let nftAcctString = nftOwner;
			if (excludeList.includes(nftOwner)) { continue; }
			if (nftOwner == zuseEscrow) {nftAcctString = `ZUSE ESCROW (${zuseEscrow})`;}
			else if (nftOwner == tsryAcc) {nftAcctString = `**TSRY**${tsryAcc}**TSRY**`; }
			else if (nftOwner == hashGuildEscrow) {nftAcctString = `HashGuild ESCROW (${hashGuildEscrow})`;}
			else if (nftOwner == hashAxisMint) {nftAcctString = `HASHAXIS MINT (${hashAxisMint})`;}
			let currentOwnership = nftOwnerMap.get(nftOwner) || [];

			if (currentOwnership.length == 0) {
				currentOwnership = [1, `${name} -> ${tokenId}@${value.serial_number}`, nftAcctString, tokenId, royaltiesStr, spender ? 1 : 0];
			}
			else {
				currentOwnership[0]++;
				currentOwnership[1] = `${currentOwnership[1]},${value.serial_number}`;
				if (spender) currentOwnership[5]++;

			}
			nftOwnerMap.set(nftOwner, currentOwnership);
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	// if wallet specified ensure a default value (to catch associated but unowned tokens)
	if (walletId != undefined) {
		let walletOwnership = nftOwnerMap.get(walletId) || [];
		if (walletOwnership.length == 0) {
			walletOwnership = [0, `${name} -> ${tokenId}@ **EMPTY ASSOCIATION**`];
			nftOwnerMap.set(walletId, walletOwnership);
		}
	}

	return nftOwnerMap;
}

async function getAssociatedButZeroAccounts(tokenId, excludeList, tsryAcc) {
	const nftOwnerList = [];

	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl = `/api/v1/tokens/${tokenId}/balances/?limit=100`;

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const balances = json.balances;

		for (let n = 0; n < balances.length; n++) {
			const balanceObj = balances[n];
			let account = balanceObj.account;
			const balance = balanceObj.balance;

			if (excludeList.includes(account)) { continue; }
			if (account == zuseEscrow) {account = `ZUSE ESCROW (${zuseEscrow})`;}
			else if (account == tsryAcc) {account = `**TSRY**${tsryAcc}**TSRY**`; }
			else if (account == hashGuildEscrow) {account = `HashGuild ESCROW (${hashGuildEscrow})`;}
			else if (account == hashAxisMint) {account = `HASHAXIS MINT (${hashAxisMint})`;}

			if (balance == 0) nftOwnerList.push(account);
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return nftOwnerList;
}

async function getNFTListingStats(tokenId, tsryAct, verbose = false) {
	let listedCount = 0;
	let unlistedCount = 0;
	let totalNFts = 0;

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
			console.log(`Batch ${batch} - Processing item:', ${n}, 'of', ${nfts.length}`);
			totalNFts++;
			const nft = nfts[n];
			const serial = nft.serial_number;

			if (nft.deleted) continue;
			const nftOwner = nft.account_id;

			if (nftOwner == tsryAct || nftOwner == zuseLaunchpad) {
				if (verbose) {
					console.log(`Token ${tokenId} / #${serial} remains in treasury/launchpad`);
				}
				continue;
			}

			if (nftOwner == zuseEscrow || nftOwner == hashGuildEscrow || nftOwner == hashAxisMint) {
				if (verbose) {
					console.log(`Token ${tokenId} / #${serial} is listed via escrow`);
				}
				listedCount++;
				continue;
			}

			const spender = nft.spender;

			if (spender) {
				if (verbose) {
					console.log(`Token ${tokenId} / #${serial} is listed via spender authorisation`);
				}
				listedCount++;
				continue;
			}

			unlistedCount++;

		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return [unlistedCount, listedCount, totalNFts];
}

async function getSerialNFTOwnershipForAudit(tokenId, serialsList, tsryAct, excludeList, hodl, epoch, verbose) {

	const nftOwnerMap = [];

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
			console.log(`Batch ${batch} - Processing item:', ${n}, 'of', ${nfts.length}`);
			const value = nfts[n];
			const serial = value.serial_number;
			if (serialsList.length > 0) {
				if (!serialsList.includes(`${serial}`)) {
					continue;
				}
			}

			if (value.deleted) continue;
			const nftOwner = value.account_id;
			if (excludeList.includes(nftOwner)) {
				continue;
			}

			let spender = value.spender;

			if (spender == zuseEscrow) {spender = 'ZUSE LISTING';}
			else if (spender == hashGuildEscrow) {spender = 'HASHGUILD LISTING';}
			else if (spender == hashAxisMint) {spender = 'HASHAXIS';}

			if (hodl) {
				// also get the HODL date
				const url = `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${tokenId}/nfts/${serial}/transactions?limit=1`;
				if (verbose) { console.log(url);}

				const jsonHODL = await fetchJson(url);
				// we only requested the last one
				const transactions = jsonHODL.transactions;
				const tx = transactions[0];
				const hodlDate = new Date(tx.consensus_timestamp * 1000);
				if (hodlDate > epoch) continue;
				let fromAccount = tx.sender_account_id;

				if (fromAccount == tsryAct) {
					fromAccount = `MINT/TREASURY (${tsryAct})`;
				}
				else if (fromAccount == zuseEscrow) {
					fromAccount = `ZUSE (${zuseEscrow})`;
				}
				else if (fromAccount == hashGuildEscrow) {
					fromAccount = `HASHGUILD (${hashGuildEscrow})`;
				}
				else if (fromAccount == hashAxisMint) {
					fromAccount = `HASHAXIS (${hashAxisMint})`;
				}
				nftOwnerMap.push([nftOwner, tokenId, serial, spender, fromAccount, hodlDate]);
			}
			else {
				nftOwnerMap.push([nftOwner, tokenId, serial, spender]);
			}
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return nftOwnerMap;
}

async function getSerialFungibleCommonOwnership(tokenId, name, decimals, walletId = null, excludeList, verbose) {
	const nftOwnerMap = new Map();

	// base URL
	const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
	let routeUrl;
	if (walletId) {
		routeUrl = `/api/v1/tokens/${tokenId}/balances?account.id=${walletId}`;
	}
	else {
		routeUrl = `/api/v1/tokens/${tokenId}/balances?limit=100`;
	}
	if (verbose) { console.log(baseUrl + routeUrl);}

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return;
		}
		const nfts = json.balances;

		nfts.forEach(async function(value) {
			const nftOwner = value.account;
			if (excludeList.includes(nftOwner)) { return; }
			const balance = value.balance * (10 ** -decimals);


			nftOwnerMap.set(nftOwner, [balance, `**FC** ${name} -> ${balance.toLocaleString('en-US')} of ${tokenId} tokens **FC**`, nftOwner, tokenId]);
		});

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return nftOwnerMap;
}

async function getTokensInWallet(wallet, getZeroFlag, verbose) {

	const url = `https://mainnet-public.mirrornode.hedera.com/api/v1/balances?account.id=${wallet}`;
	if (verbose) {console.log(url);}

	const json = await fetchJson(url);
	const tokens = json.balances;

	const tokenList = [];

	tokens.forEach(async function(value) {
		const nfts = value.tokens;
		nfts.forEach(async function(v) {
			if (getZeroFlag) {
				if (v.balance == 0) {
					tokenList.push(v.token_id);
				}
			}
			else {
				tokenList.push(v.token_id);
			}
		});
	});
	return tokenList;
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


async function main() {


	let wholeWallet = false;
	let printAllOwners = false;
	const auditOutput = getArgFlag('audit');
	const auditSerialsOutput = getArgFlag('auditserials');
	const startTime = new Date();

	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node checkOwnership.mjs [-w <wallet> [-zero]] [-t <token> [-zero] [-listed] [-s <serials>] -ex <wallet>] [-r] [-audit] [-auditserials [-hodl] [-epoch XXX]]] [-v] [-version]');
		console.log('       -w <wallet> if not specified will look for all wallets on token');
		console.log('             -zero  only show zero balances for wallet specified');
		console.log('       -t <token>  if not specified look for all tokens in given wallet');
		console.log('             -zero  only show wallet with 0 balance ready for airdrop');
		console.log('       -ex <wallet> 0.0.XXXX,0.0.YYYY to exclude wallets from display');
		console.log('       -threshold   minimum ownership [default: 1]');
		console.log('       -r          show token royalties');
		console.log('       -s <serials> check wallets onwning specified serials');
		console.log('                    (comma seperated or - for range e.g. 2,5,10 or 1-10)');
		console.log('       -audit      a simple token ownership audit output - saves to file');
		console.log('       -auditserials  a simple *serials* ownership audit output - saves to file');
		console.log('       -hodl       used with auditserials to get hodl data per serial');
		console.log('       -epoch XXXX used with hodl to exclude anyoe buying post date/time');
		console.log('       -listed     statistics on listed supply for a token');
		console.log('       		e.g. node checkOwnership.mjs -t 0.0.XXXX -listed');
		console.log('       -v          verbose [debug]');
		console.log('       -version    displays version number and exits');
		return;
	}

	if (getArgFlag('version')) {
		console.log(`Version: ${version}`);
		return;
	}

	const verbose = getArgFlag('v');

	let threshold = getArg('threshold');

	if (threshold === undefined) {
		threshold = 1;
	}

	let tokenId = getArg('t');

	const showRoyalties = getArgFlag('r');

	// look if wallet specified
	const walletId = getArg('w');

	const getZeroFlag = getArgFlag('zero');
	if (getZeroFlag) {
		// need to lower threshold
		threshold = 0;
	}

	const hodl = getArgFlag('hodl');

	let epoch = startTime;
	if (getArgFlag('epoch')) epoch = new Date(getArg('epoch') * 1000);

	const serialsArg = getArg('s');
	let serialsCheck = false;
	let serialsList = [];

	if (tokenId === undefined) {
		wholeWallet = true;
	}

	if (walletId === undefined) {
		if (tokenId === undefined) {
			console.log('**MUST** specify minimum token *OR* wallet to use -> Usage: node checkOwnership.js -h');
			return;
		}
		printAllOwners = true;
		wholeWallet = false;
	}
	// if looking for serial ownership token must be specific
	// && must be NFT not FC token
	if (serialsArg !== undefined) {
		if (tokenId === undefined) {
			console.log('**MUST** specify token to check serials -> Usage: node checkOwnership.js -h');
			return;
		}
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

	const excludeArg = getArg('ex');
	let excludeList = [];

	if (excludeArg !== undefined) {

		// format csv or '-' for range
		if (excludeArg.includes(',')) {
			excludeList = excludeArg.split(',');
		}
		else {
			// only one serial to check
			excludeList = [excludeArg];
		}
	}

	let tokenList = [];


	if (wholeWallet) {
		tokenList = await getTokensInWallet(walletId, getZeroFlag, verbose);
	}
	else if (tokenId.includes(',')) {
		tokenList = tokenId.split(',');
	}
	else {
		tokenList = [tokenId];
	}

	const getListedStats = getArgFlag('listed');


	let returnArray;
	let nftOwnerMap;
	let auditCSV;
	// overal stats
	let wholeWalletTotal = 0;
	let wholeWalletUnique = 0;
	let wholeWalletZeroCollections = 0;

	if (auditOutput) { auditCSV = 'Wallet,Token,Owned,Timestamp'; }
	if (auditSerialsOutput) {
		if (hodl) {
			auditCSV = 'Wallet,Token,Serial,SpenderAuthorised,From Account,HODL Time,Timestamp';
		}
		else {
			auditCSV = 'Wallet,Token,Serial,SpenderAuthorised,Timestamp';
		}
	}
	for (let i = 0; i < tokenList.length; i++) {

		tokenId = tokenList[i];
		if (verbose) {console.log(`processing token: ${tokenId}`);}
		returnArray = await getTokenDetails(tokenId, verbose);

		if (returnArray[1] == 'FUNGIBLE_COMMON') {
			if (serialsCheck) {
				console.log(`**CAN ONLY CHECK SERIALS for type NFT - ${tokenId} is of type FUNGIBLE_COMMON`);
				return;
			}
			// gomint API assumed
			nftOwnerMap = await getSerialFungibleCommonOwnership(tokenId, returnArray[3], returnArray[4], walletId, excludeList, verbose);
		}
		else if (auditSerialsOutput) {
			nftOwnerMap = await getSerialNFTOwnershipForAudit(tokenId, serialsList, returnArray[6], excludeList, hodl, epoch, verbose);
		}
		else if (getListedStats) {
			const [unlistedCount, listedCount, totalNFts] = await getNFTListingStats(tokenId, returnArray[6]);
			const percListed = (listedCount / (unlistedCount + listedCount)) * 100;
			const mintedPerc = ((unlistedCount + listedCount) / totalNFts) * 100;
			console.log(`Stats for ${tokenId}:\n${parseFloat(percListed).toFixed(3) + '%'}/${listedCount} listed of ${unlistedCount + listedCount} minted supply.\n${totalNFts} collection size (minted ${parseFloat(mintedPerc).toFixed(3) + '%'})`);
			continue;
		}
		else if (!wholeWallet && getZeroFlag) {
			// output a list of accounts with the token associated but 0 balance
			getAssociatedButZeroAccounts(tokenId, excludeList, returnArray[5]).then((acctList) => {
				console.log('Airdrop script format');
				for (let a = 0; a < acctList.length; a++) {
					console.log(`${acctList[a]},${tokenId},1,0`);
				}
			});
			return;
		}
		else {
			nftOwnerMap = await getSerialNFTOwnership(tokenId, walletId, returnArray[3], serialsList, returnArray[5], returnArray[6], excludeList, verbose);
		}

		let uniqueWallets = 0;
		let totalOwned = 0;

		if (auditSerialsOutput) {
			for (let n = 0; n < nftOwnerMap.length; n++) {
				if (excludeList.includes(nftOwnerMap[n][0])) continue;
				if (hodl) {
					auditCSV += `\n${nftOwnerMap[n][0]},${nftOwnerMap[n][1]},${nftOwnerMap[n][2]},${nftOwnerMap[n][3]},${nftOwnerMap[n][4]},${nftOwnerMap[n][5].toISOString()},${startTime.toISOString()}`;
				}
				else {
					auditCSV += `\n${nftOwnerMap[n][0]},${nftOwnerMap[n][1]},${nftOwnerMap[n][2]},${nftOwnerMap[n][3]},${startTime.toISOString()}`;
				}
			}
		}
		else {
			nftOwnerMap.forEach(function(value, key) {
				// print out for specified wallet
				totalOwned += value[0];
				uniqueWallets++;

				// requested simple audit output -> Wallet ID, token ID, count
				if (auditOutput) {
					if (value[0] > 0) {
						auditCSV += `\n${value[2]},${value[3]},${value[0]},${startTime.toISOString()}`;
					}
				}
				else if (printAllOwners || key == walletId || serialsCheck) {
					if (value[0] >= threshold) {
						if (wholeWallet) {
							wholeWalletTotal += value[0];
							wholeWalletUnique++;
						}
						if (showRoyalties) {
							console.log(`Account ${value[2]} owns ${value[0].toLocaleString('en-US')} -> Royalties: ${value[4]} -> ${value[1]} [${value[5]} listed / spender authorised]`);
						}
						else {
							console.log(`Account ${value[2]} owns ${value[0].toLocaleString('en-US')} -> ${value[1]} [${value[5]} listed / spender authorised]`);
						}
					}
					else if (wholeWallet) {wholeWalletZeroCollections++;}
				}
			});
		}

		if (!wholeWallet && !(auditOutput || auditSerialsOutput)) console.log(`Found ${totalOwned.toLocaleString('en-US')} of ${tokenId} across ${uniqueWallets} wallet(s)`);

	}

	if (wholeWallet) {
		console.log(`Found ${wholeWalletTotal} tokens [unique collections -> ${wholeWalletUnique} & zero owned but associated transactions ${wholeWalletZeroCollections} for ${walletId}`);
	}

	if (auditOutput || auditSerialsOutput) {
		const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
		fs.writeFile(`./auditOuput${timestamp}.csv`, auditCSV, () => {
			console.log('Audit File created');
		});
	}

}

main();
