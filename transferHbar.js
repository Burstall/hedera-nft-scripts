const {
	Client,
	PrivateKey,
	AccountId,
	TransferTransaction,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');

const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const env = process.env.ENVIRONMENT || null;
let client;

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node transferHbar.js -rec 0.0.XXXX -amt Z [-memo \'ABC DEF\' ][-multisig]');
		console.log('       -rec 			address of the receving account');
		console.log('       -amt 			amount to send');
		console.log('       -multisig 		flag to look for multisig signing');
		process.exit(0);
	}

	const multiSig = getArgFlag('multisig');
	const memo = getArg('memo');

	const receiver = AccountId.fromString(getArg('rec'));

	if (!receiver) {
		console.log('Must specify receiver - exiting');
		process.exit(1);
	}

	const amount = Number(getArg('amt'));
	if (!receiver) {
		console.log('Must specify amount - exiting');
		process.exit(1);
	}

	if (!env || !operatorId || !operatorKey) {
		console.log('Please check environment variables ar set -> MY_PRIVATE_KEY / MY_PRIVATE_KEY / ENVIRONMENT');
		process.exit(1);
	}

	console.log(`- Using account: ${operatorId} as sender`);
	console.log('- Using ENVIRONMENT:', env);

	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('Transfer hbar in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('Transfer hbar in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const result = await transferHbarFcn(operatorId, receiver, amount, memo, multiSig);

	if (result) {
		console.log('\n-Transfer completed');
	}
	else {
		console.log('\n-**FAILED**');
	}

}

/**
 * Helper method for the hbar transfer
 * @param {AccountId} sender
 * @param {AccountId} receiver
 * @param {Number} amount
 * @param {string} memo
 * @param {boolean} multiSig default false, set true if to spit out bytes and take the returned signed ones
 * @returns {boolean} outcome of the requested transfer
 */
async function transferHbarFcn(sender, receiver, amount, memo = null, multiSig = false) {
	// add signature documented to require only single node to be used.
	const nodeId = [];
	nodeId.push(new AccountId(3));

	const transferTx = new TransferTransaction()
		.addHbarTransfer(receiver, amount)
		.addHbarTransfer(sender, -amount)
		.setNodeAccountIds(nodeId);

	if (memo) {
		transferTx.setTransactionMemo(memo);
	}

	transferTx.freezeWith(client);

	let transferSigned;

	if (multiSig) {
		console.log('\n-MultiSig signing\n');
		const txClockStart = new Date();
		const knownSig = (await transferTx.sign(operatorKey)).toBytes();
		const knownPublicKey = operatorKey.publicKey;
		transferSigned = transferTx.addSignature(knownPublicKey, knownSig);

		const txAsBytes = transferTx.toBytes();
		const txBytesAsBase64 = Buffer.from(txAsBytes).toString('base64');

		console.log('Please collect the additional signatures:\n\n' +
			'return format <public key1>:<signed bytes1>,<public key2>:<signed bytes2>,' +
			'<public key3>:<signed bytes3> etc.\n\n-------Copy between lines-------\n' +
			txBytesAsBase64 + '\n-------Copy between lines-------');


		// wait on user entry
		const ac = new AbortController();
		const signal = ac.signal;

		const encodedSignedTxs = readlineSync.question('\n\nPlease enter signed transactions', { signal });

		signal.addEventListener('abort', () => {
			console.log('The transaction has timed out');
		}, { once: true });

		setTimeout(() => ac.abort(), 120000);

		console.log('input:' + encodedSignedTxs + '@');
		// split user input on comma
		const encodedSignedTxList = encodedSignedTxs.split(',');
		console.log(encodedSignedTxList);

		// for each tuple of public key:bytes
		let sigsFound = 0;
		for (let t = 0; t < encodedSignedTxList.length; t++) {
			const tuple = encodedSignedTxList[t];
			if (!tuple) continue;
			// split on :
			const [pubKey, encodedTx] = tuple.split(':');
			// add signatures
			transferSigned = transferTx.addSignature(pubKey, encodedTx);
			sigsFound++;
		}
		console.log('\n\n-Added ' + sigsFound + ' signatures');

		const txClockEnd = new Date();
		// check if 119 seconds or greater have elapsed
		if ((txClockEnd.getTime() - txClockStart.getTime()) >= 119000) {
			console.log('Likely time elapsed -- expect tx to fail');
		}


	}
	else {
		console.log('\n-Single signing\n');
		transferSigned = await transferTx.sign(operatorKey);
	}

	const transferSubmit = await transferSigned.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);

	return transferRx.status.toString() == 'SUCCESS' ? true : false;
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