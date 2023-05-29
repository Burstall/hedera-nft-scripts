const cron = require('node-cron');
const baseUrl = process.env.MIRROR_NODE_BASEURL || 'https://mainnet-public.mirrornode.hedera.com';
const maxRetries = Number(process.env.MAX_RETRY) || 3;
let wallet, lastRun;

// runs the task every 2 mins at :30 seconds
cron.schedule('30 */2 * * * *', () => {
	run();
});

async function run() {
	const thresholdTimeAsSeconds = Math.floor((lastRun.getTime()) / 1000);
	console.log('thresholdTimeAsSeconds', thresholdTimeAsSeconds, lastRun.getTime());

	const pathUrl = `/api/v1/transactions?account.id=${wallet}&timestamp=gte:${thresholdTimeAsSeconds}`;
	lastRun = new Date();
	const acctBalMap = await pullTransactions(pathUrl);

	acctBalMap.forEach((amt, acct) => {
		console.log('0.0.' + acct + '\t' + amt);
	});
}

async function pullTransactions(pathUrl, accountBalanceMap = new Map()) {
	try {
		const data = await fetchJson(baseUrl + pathUrl);
		// iterate through transactions checking time stamp in bounds and wallet too.
		for (let i = 0; i < data.transactions.length; i++) {
			const tx = data.transactions[i];
			const memo = Buffer.from(tx.memo_base64, 'base64').toString();
			let textFound = false;
			const timestamp = tx.consensus_timestamp;
			const txId = tx.transaction_id;
			console.log(txId);
			if (!parseInt(memo) && memo) {
				textFound = true;
			}

			for (let t = 0; t < tx.transfers.length; t++) {
				const transfer = tx.transfers[t];
				const account = Number(transfer.account.split('.')[2]);
				const amt = Number(transfer.amount) / 100000000;
				if (account < 100) {
					continue;
				}
				else if (textFound) {
					console.log(txId + '\t' + timestamp + '\t' + memo
									+ '\t0.0.' + account + '\t' + amt + '\t'
									+ baseUrl + '/api/v1/transactions/' + txId);
				}
				let totalAmt = accountBalanceMap.get(account) || 0;
				totalAmt += amt;
				accountBalanceMap.set(account, totalAmt);
			}
		}

		if (data.links.next) {
			return await pullTransactions(data.links.next, accountBalanceMap);
		}

	}
	catch (err) {
		console.error('ERROR looking up transactions:', baseUrl, pathUrl, err);
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

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
};

async function main() {
	const args = process.argv.slice(2);
	if (args.length == 1) {
		wallet = args[0];

		console.log('Tracking for transactions to wallet: ' + wallet);
		lastRun = new Date();
	}
	else {
		console.error('usage: node schedulerExample.js <wallet>');
	}
}

main();