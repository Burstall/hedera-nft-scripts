const fetch = require('cross-fetch');
const process = require('node:process');
const {
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const fs = require('fs');

const maxRetries = 11;
const baseUrl = 'https://mainnet-public.mirrornode.hedera.com';
const tokensUrl = '/api/v1/tokens/';
const txsUrl = '/api/v1/transactions/';
let verbose = false;
let outputAsFile = true;
const addressRegex = /(0\.0\.[1-9][0-9]+)/i;
const rpsThreshold = 50;
let threshold = 1;

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

async function fetchJson(url, depth = 0) {
	if (depth >= maxRetries) return null;
	depth++;
	try {
		const res = await fetchWithTimeout(url);
		if (res.status != 200) {
			if (depth > 4) console.log(depth, url, res);
			await sleep(2000 * depth);
			return await fetchJson(url, depth);
		}
		return res.json();

	}
	catch (err) {
		await sleep(3000 * depth);
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

async function isTokenNFT(tokenId) {
	const routeUrl = tokensUrl + tokenId;

	if (verbose) console.log('checking token type:', baseUrl + routeUrl);

	const tokenDetailJSON = await fetchJson(baseUrl + routeUrl);

	const tokenType = tokenDetailJSON.type;

	if (tokenType === 'NON_FUNGIBLE_UNIQUE') {
		return true;
	}
	else {
		return false;
	}
}

async function main() {
	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node getNFTTxHistory.js -t 0.0.XXXX [-s Q] [-threshold] [-console] [-v]');
		console.log('       -t <tokenId>	token to check transaction history for');
		console.log('       -s Q 			Q can be single serial (e.g. 4) or comma seperated list (e.g. 4,9,11) or range using - (e.g. 2-8)');
		console.log('       -threshold Z	supress transaction os value < Z hbar [DEFAULT: 1 hbar]');
		console.log('       -console		print output to console instead of file');
		process.exit(0);
	}

	verbose = getArgFlag('v');
	outputAsFile = !getArgFlag('console');

	const tokenArg = getArg('t') || null;
	let tokenId;
	const serialsArg = getArg('s') || null;
	let serialsList = [];
	// check if this is an NFT, if so has serial been set?
	let isNFT;
	if (tokenArg) {
		tokenId = tokenArg.match(addressRegex)[0];
		console.log('Processing token:', tokenId);
		isNFT = await isTokenNFT(tokenId);
	}
	else {
		// need to have a token specified
		console.log('No token specified, please use -t 0.0.XXXX and rerun');
		process.exit(1);
	}

	if (isNFT) {
		if (serialsArg) {
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
		else {
			console.log('No serial specified, grabbing history for all serials of', tokenId);
		}
	}
	else {
		console.log(`Token (${tokenId}) is not an NFT - aborting`);
		process.exit(1);
	}

	if (getArgFlag('threshold')) {
		threshold = Number(getArg('threshold'));
	}

	if (!serialsArg) {
		// get all serials
		serialsList = await getAllNFTSerials(tokenId);
	}


	const promiseList = [];
	for (let s = 0; s < serialsList.length; s++) {
		promiseList.push(pullNFTTxHistory(tokenId, serialsList[s]));
		if (s % rpsThreshold == 0) await sleep(1000);
	}

	// get unique list of Tx Ids
	const txList = [];
	const completeNftTxList = [];
	await Promise.all(promiseList).then((nftTxListOfLists) => {

		for (let n = 0; n < nftTxListOfLists.length; n++) {
			const nftTxList = nftTxListOfLists[n];
			for (let t = 0; t < nftTxList.length; t++) {
				const nftTx = nftTxList[t];
				completeNftTxList.push(nftTx);
				if (nftTx instanceof NFTTransaction) {
					const txId = nftTx.txId;
					if (!txList.includes(txId)) txList.push(txId);
				}
			}
		}
		if (verbose) console.log('Tx list to grab', txList);

	});

	// get the Tx details and create a map
	const txPromiseList = [];
	for (let t = 0; t < txList.length; t++) {
		txPromiseList.push(getTransactionObject(txList[t], t));
		if (t % rpsThreshold == 0) await sleep(1000);
	}

	const txObjMap = new Map();
	await Promise.all(txPromiseList).then((txObjList) => {
		for (let tol = 0; tol < txObjList.length; tol++) {
			const txObj = txObjList[tol];
			if (txObj instanceof Transaction) {
				txObjMap.set(txObj.txId, txObj);
			}
		}
	});

	let outputStr = 'Receiver\tSender\tToken\tSerial\tPmtAmount\tPkgTrade\tType\ttxId\tEpochTime\tDateTime\n';
	// process the NFTs moves looking for payment flow, P2P, marketplace txs.

	for (let t = 0; t < completeNftTxList.length; t++) {
		const nftTx = completeNftTxList[t];
		if (nftTx instanceof NFTTransaction) {
			const txId = nftTx.txId;
			const txObj = txObjMap.get(txId);

			if (txObj instanceof Transaction && txObj.isPmtAtThreshold(threshold)) {
				// include in the stats.
				outputStr += nftTx.receiverWallet + '\t' +
							nftTx.senderWallet + '\t' +
							nftTx.tokenId + '\t' +
							nftTx.getSerialString() + '\t' +
							txObj.pmtAmount + '\t' +
							txObj.isPackageTrade() + '\t' +
							nftTx.txType + '\t' +
							nftTx.txId + '\t' +
							nftTx.consensusTime + '\t' +
							nftTx.consensusTimeAsDate + '\t' +
							'\n';
			}
			else if (verbose) {
				console.log(`Skipping ${txId} as sent for <${threshold} hbar [${txObj.pmtAmount}]`);
			}
		}
	}
	const timeNow = new Date();
	const timestamp = timeNow.toISOString().split('.')[0].replaceAll(':', '-');
	if (outputAsFile) {
		fs.writeFileSync(`./${tokenId}_Transactions_${timestamp}.tsv`, outputStr, () => {
			console.log('Transaction File created');
		});
	}
	else {
		console.log(outputStr);
	}
}

async function getTransactionObject(txId, txIteration = 0) {
	const routeUrl = txsUrl + txId;
	await sleep(10 * txIteration);
	if (verbose) console.log('processing tx:', txIteration);

	let txObj = null;

	if (verbose) { console.log(baseUrl + routeUrl);}


	const json = await fetchJson(baseUrl + routeUrl);
	if (json == null) {
		console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
		// unlikely to get here but a sensible default
		return txObj;
	}
	const transactions = json.transactions;

	const tx = transactions[0];

	const nftTransfers = tx.nft_transfers;
	const nftTransfersList = [];
	if (nftTransfers) {
		for (let n = 0; n < nftTransfers.length; n++) {
			const tfr = nftTransfers[n];
			const nftTfr = new NFTTransfer(tfr.token_id, tfr.serial_number,
				tfr.sender_account_id, tfr.receiver_account_id, tfr.is_approval);
			nftTransfersList.push(nftTfr);
		}
	}
	else if (verbose) {
		console.log('No NFT Transfer found in:', baseUrl + routeUrl);
	}

	const transfers = tx.transfers;
	const transfersList = [];
	if (transfers) {
		for (let tL = 0; tL < transfers.length; tL++) {
			const tfr = transfers[tL];
			const tfrObj = new Transfer(tfr.account, tfr.amount,
				tfr.is_approval);
			transfersList.push(tfrObj);
		}
	}
	else if (verbose) {
		console.log('No Transfer found in:', baseUrl + routeUrl);
	}

	txObj = new Transaction(tx.transaction_id, tx.consensus_timestamp,
		tx.charged_tx_fee, nftTransfersList, transfersList, tx.scheduled, tx.result,
		tx.name);

	return txObj;
}

async function pullNFTTxHistory(tokenId, serial) {
	let routeUrl = tokensUrl + tokenId + '/nfts/' + serial + '/transactions?limit=100';

	const nftTxList = [];

	if (verbose) { console.log(baseUrl + routeUrl);}

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return nftTxList;
		}
		const transactions = json.transactions;

		for (let t = 0; t < transactions.length; t++) {
			const tx = transactions[t];

			const nftTx = new NFTTransaction(tx.transaction_id, tx.consensus_timestamp,
				tokenId, serial, tx.receiver_account_id, tx.sender_account_id, tx.is_approval,
				tx.type);
			nftTxList.push(nftTx);
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return nftTxList;
}

async function getAllNFTSerials(tokenId) {
	const serialList = [];

	let routeUrl = tokensUrl + tokenId + '/nfts/?limit=100';

	if (verbose) { console.log(baseUrl + routeUrl);}

	do {
		const json = await fetchJson(baseUrl + routeUrl);
		if (json == null) {
			console.log('FATAL ERROR: no NFTs found', baseUrl + routeUrl);
			// unlikely to get here but a sensible default
			return serialList;
		}
		const nfts = json.nfts;

		for (let n = 0; n < nfts.length; n++) {
			const value = nfts[n];

			// check if serial is deleted
			if (value.deleted) {
				continue;
			}
			else {
				serialList.push(value.serial_number);
			}
		}

		routeUrl = json.links.next;
	}
	while (routeUrl);

	return serialList;
}

// create an object to simplify rather thn passing arrays around
class NFTTransaction {
	constructor(txId, consensusTime, tokenId, serial,
		receiverWallet, senderWallet, isApproval, txType) {
		this.txId = txId;
		this.consensusTime = consensusTime;
		this.consensusTimeAsDate = new Date(consensusTime * 1000);
		this.receiverWallet = receiverWallet;
		this.senderWallet = senderWallet;
		this.tokenId = tokenId;
		this.serialArray = [serial];
		this.isApproval = isApproval;
		this.txType = txType;
	}


	addSerial(serial) {
		if (!this.serialList.includes(serial)) this.serialList.push(serial);
	}

	getSerialString() {
		let serialString = '';
		for (let s = 0; s < this.serialArray.length; s++) {
			if (s > 0) {
				serialString += ',' + this.serialArray[s];
			}
			else {
				serialString += this.serialArray[s];
			}
		}
		return serialString;
	}

	toString() {
		return `${this.txId},${this.consensusTime},${this.consensusTimeAsDate.toISOString().split('.')[0]},` +
			`${this.receiverWallet},${this.senderWallet},${this.tokenId},[${this.getSerialString()}],` +
			`${this.isApproval},${this.txType}`;
	}

	setSerials(newSerialArray) {
		this.serialArray = newSerialArray;
	}
}

class NFTTransfer {
	constructor(tokenId, serial, sender, receiver, isApproval) {
		this.tokenId = tokenId;
		this.serial = serial;
		this.sender = sender;
		this.receiver = receiver;
		this.isApproval = isApproval;
	}

	toString() {
		return `${this.tokenId},${this.serial},${this.receiver},${this.sender},${this.isApproval}`;
	}

	toStringVerbose() {
		return `Token ${this.tokenId}/#${this.serial} sent to ${this.receiver} from ${this.sender}`;
	}
}

class Transfer {
	constructor(account, amount, isApproval) {
		this.account = account;
		this.amount = amount;
		this.isApproval = isApproval;
	}

	toString() {
		return `${this.tokenId},${this.serial},${this.receiver},${this.sender},${this.isApproval}`;
	}

	toStringVerbose() {
		return `Token ${this.tokenId}/#${this.serial} sent to ${this.receiver} from ${this.sender}`;
	}
}

// create an object to simplify rather thn passing arrays around
class Transaction {
	constructor(txId, consensusTime, chargedFee, nftTransfersList,
		transfersList, isScheduled, txResult, txName) {
		this.txId = txId;
		this.consensusTime = consensusTime;
		this.consensusTimeAsDate = new Date(consensusTime * 1000);
		this.chargedFee = chargedFee;
		this.nftTransfersList = nftTransfersList;
		this.transfersList = transfersList;
		this.pmtAmount = 0;
		// extract pmt amount
		if (this.transfersList) {
			for (let t = 0; t < this.transfersList.length; t++) {
				const tfr = this.transfersList[t];
				if (tfr instanceof Transfer) {
					const amt = tfr.amount;
					if (amt < 0) {
						// Assumption to verify -> only one pmt per transaction
						this.pmtAmount = new Hbar((-1 * amt), HbarUnit.Tinybar).toBigNumber();
						break;
					}
				}
			}
		}
		this.txResult = txResult;
		this.isScheduled = isScheduled;
		this.txName = txName;
	}

	isPackageTrade() {
		if (this.nftTransfersList.length > 1) {
			return true;
		}
		else {
			return false;
		}
	}

	isPmtAtThreshold(hbarAmt) {
		return this.pmtAmount >= hbarAmt ? true : false;
	}

	toString() {
		let nftTransfersListStr = '';
		for (let n = 0; n < this.nftTransfersList.length; n++) {
			const nftTfr = this.nftTransfersList[n];
			if (nftTfr instanceof NFTTransfer) {
				nftTransfersListStr += n == 0 ? '{' : ',{' + nftTfr.toString() + '}';
			}
		}

		let transfersListStr = '';

		for (let t = 0; t < this.transfersList.length; t++) {
			const tfr = this.transfersList[t];
			if (tfr instanceof Transfer) {
				transfersListStr += t == 0 ? '{' : ',{' + tfr.toString() + '}';
			}
		}

		return `${this.txId},${this.consensusTime},${this.consensusTimeAsDate.toISOString().split('.')[0]},` +
			`${this.chargedFee},[${nftTransfersListStr}],[${transfersListStr}],${this.pmtAmount},` +
			`${this.txResult},${this.isScheduledTx},${this.isApproval},${this.txResult},${this.txName}`;
	}

}

main();