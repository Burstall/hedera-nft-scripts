import { fetch } from 'cross-fetch';
import * as fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
const baseUrl = process.env.MIRROR_NODE_BASEURL || 'https://mainnet-public.mirrornode.hedera.com';
const maxRetries = Number(process.env.MAX_RETRY) || 3;
let totalTxProcessed = 0;
let totalTxEntries = 0;
let excludeList = [];

async function pullTransactions(pathUrl, wallet, tokenId, tokenDecimal, accountBalanceMap = new Map()) {
	try {
		const data = await fetchJson(baseUrl + pathUrl);
		// iterate through transactions checking time stamp in bounds and wallet too.
		for (let i = 0; i < data.transactions.length; i++) {
			totalTxProcessed++;
			const tx = data.transactions[i];
			if (tx.token_transfers) {
				for (let t = 0; t < tx.token_transfers.length; t++) {
					const transfer = tx.token_transfers[t];
					const token_id = transfer.token_id;
					if (token_id != tokenId) continue;
					const account = transfer.account;
					const amt = -Number(transfer.amount) / (1 * (10 ** tokenDecimal));
					// only look at credits to the account
					if (excludeList.includes(account)) continue;
					if (account != wallet && amt > 0) {
						let totalAmt = accountBalanceMap.get(account) || 0;
						totalAmt += amt;
						accountBalanceMap.set(account, totalAmt);
						totalTxEntries++;
						// console.log(account, amt, totalAmt);
					}
				}
			}
		}

		if (data.links.next) {
			return await pullTransactions(data.links.next, wallet, tokenId, tokenDecimal, accountBalanceMap);
		}

	}
	catch (err) {
		console.error('ERROR looking up transactions:', baseUrl + pathUrl, err);
	}

	return accountBalanceMap;
}

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	depth++;
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			// console.log(depth, url, res);
			await sleep(1000 * depth);
			return await fetchJson(url, depth);
		}
		return res.json();

	}
	catch (err) {
		await sleep(1000 * depth);
		return await fetchJson(url, depth);
	}
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

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
};

async function getTokenType(tokenId) {
	const routeUrl = `/api/v1/tokens/${tokenId}`;

	const tokenDetailJSON = await fetchJson(baseUrl + routeUrl);

	return [tokenDetailJSON.type, tokenDetailJSON.decimals, tokenDetailJSON.name];
}

async function main() {
	if (getArgFlag('h')) {
		console.log('usage: node checkFTRaffleEntries.mjs -cost XX -start <epoch> -end <epoch> -wallet 0.0.ZZZ -token 0.0.QQQ [-exclude 0.0.XX,0.0.WW]');
		console.log('				-cost 	the cost of a ticket in hbar');
		console.log('				-start 	start time as EPOCH');
		console.log('				-end 	end time as EPOCH');
		console.log('				-wallet	wallet to search txs for');
		console.log('				-token	FT token for payment 0.0.QQQ');
		console.log('				-exclude	wallets to exclude comma delimited');
		console.log('https://www.epochconverter.com/ may be usueful for conversion');
		process.exit(0);
	}
	const wallet = getArg('wallet');
	const startTime = getArg('start');
	const endTime = getArg('end');
	const cost = getArg('cost');
	const token = getArg('token');

	if (getArgFlag('exclude')) {
		excludeList = getArg('exclude').split(',');
	}

	const [tokenType, tokenDecimal, tokenName] = await getTokenType(token);
	if (tokenType == 'NON_FUNGIBLE_UNIQUE') {
		console.log('Script designed for FT not NFT - exiting');
		process.exit(1);
	}

	console.log('Using:' +
					'\nWallet: ' + wallet +
					'\nExcluding: ' + excludeList +
					'\nStart: ' + new Date(startTime * 1000).toISOString() +
					'\nEnd: ' + new Date(endTime * 1000).toISOString() +
					'\nTicket Cost: ' + cost +
					'\nPaid in: ' + token + ' (' + tokenName + ')',
	);

	if (!wallet || !startTime || !endTime || !cost || !token) {
		console.log('Parameters missing - please check the command or run with -h for usage');
		process.exit(1);
	}

	const pathUrl = `/api/v1/transactions?account.id=${wallet}&transactionType=cryptotransfer&type=credit&timestamp=gte:${startTime}&timestamp=lte:${endTime}`;
	const acctBalMap = await pullTransactions(pathUrl, wallet, token, tokenDecimal);

	console.log('Wallet\tPaid\tTickets\tWasted');
	let totalAmount = 0;
	let totalTickets = 0;
	let wheelSpinString = '';
	// acctBalMap.forEach((amt, acct) => {
	for (const [acct, amt] of acctBalMap.entries()) {
		const entries = Math.floor(amt / cost);
		totalTickets += entries;
		console.log(acct + '\t' + amt + '\t' + entries + '\t' + amt % cost);
		totalAmount += amt;
		for (let e = 0; e < entries; e++) {
			wheelSpinString += acct + '\n';
		}
	}

	console.log('Transactions processed: ' + totalTxProcessed);
	console.log('\t of which valid entries: ' + totalTxEntries);
	console.log('\ttotal ' + tokenName + ' collected: ', totalAmount);
	console.log('\t\ttickets: ', totalTickets);

	try {

		const outputTime = new Date();
		const timestamp = outputTime.toISOString().split('.')[0].replaceAll(':', '-');
		const filename = `./${tokenName}-raffles-${timestamp}.txt`;

		fs.writeFile(filename, wheelSpinString, { flag: 'w' }, function(err) {
			if (err) {return console.error(err);}
			// read it back in to be sure it worked.
			fs.readFile(filename, 'utf-8', function(err) {
				if (err) {
					console.log('Reading file failed -- printing to console');
					console.log(wheelSpinString);
				}
				console.log('Wheel spin file created', filename);
			});
		});
	}
	catch (err) {
		// If we fail to write it then spit out the values to command line so not lost
		console.log('Error writing file -- bailing', err);

		console.log(wheelSpinString);
		process.exit(1);
	}

}

main();