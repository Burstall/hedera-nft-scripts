const {
	Client,
	PrivateKey,
	AccountId,
	TransferTransaction,
	Hbar,
	TransactionId,
} = require('@hashgraph/sdk');
require('dotenv').config();

const { requestMultiSig } = require('./reqMultiSig.js');

const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const env = process.env.ENVIRONMENT || null;
const readlineSync = require('readline-sync');
let client;
let isApproval = false;
let multiSig = false;
let onBehalfOfAccount;

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node transferFT.js -rec 0.0.XXXX -amt Z [-memo \'ABC DEF\' ] [-multisig] [-approval 0.0.YYY]');
		// console.log('Usage: node transferHbar.js [-sender 0.0.ZZZ] -rec 0.0.XXXX -amt Z [-memo \'ABC DEF\' ] [-multisig]');
		// console.log('       -sender 		overide the account sending - will require additional signatures');
		console.log('       -rec 			address of the receving account');
		console.log('       -amt 			amount to send');
		console.log('       -multisig		flag to look for multisig signing');
		console.log('       -approval		spend hbar from the account assuming allowance approved');
		process.exit(0);
	}

	multiSig = getArgFlag('multisig');
	isApproval = getArgFlag('approval');
	const memo = getArg('memo');

	let sender;
	if (getArgFlag('sender')) {
		// turn on multi sig function to colect additional signatures
		multiSig = true;
		sender = AccountId.fromString(getArg('sender'));
	}
	else {
		sender = operatorId;
	}

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

	console.log(`- Using account: ${sender} as sender`);
	console.log('- Receiver:', receiver.toString());
	console.log('- paying tx fees:', operatorId.toString());
	console.log('- Amount:', new Hbar(amount).toString());
	console.log('- Using ENVIRONMENT:', env);

	if (isApproval) {
		onBehalfOfAccount = AccountId.fromString(getArg('approval'));
		console.log('- Approval spend on behalf of:', onBehalfOfAccount.toString());
	}

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

	const proceed = readlineSync.keyInYNStrict('Do you want to make the transfer?');

	if (proceed) {
		const result = await transferHbarFcn(sender, receiver, amount, memo);

		if (result) {
			console.log('\n-Transfer completed');
		}
		else {
			console.log('\n-**FAILED**');
		}
	}
	else {
		console.log('User aborted');
		return;
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
async function transferHbarFcn(sender, receiver, amount, memo = null) {
	// add signature documented to require only single node to be used.
	const nodeId = [];
	nodeId.push(new AccountId(3));

	const transferTx = new TransferTransaction()
		.addHbarTransfer(receiver, amount)
		.setNodeAccountIds(nodeId)
		.setTransactionId(TransactionId.generate(operatorId));

	if (isApproval) {
		transferTx.addApprovedHbarTransfer(onBehalfOfAccount, -amount);
	}
	else {
		transferTx.addHbarTransfer(sender, -amount);
	}

	if (memo) {
		transferTx.setTransactionMemo(memo);
	}

	transferTx.freezeWith(client);

	let transferSigned;

	if (multiSig) {
		// request other signatures
		transferSigned = await requestMultiSig(transferTx);
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


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});