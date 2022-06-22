const {
	Client, PrivateKey, AccountBalanceQuery, TokenAssociateTransaction, TokenDissociateTransaction, TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();

const accountTokenOwnershipMap = new Map();
let verbose = false;

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

async function main() {

	// Grab your Hedera testnet account ID and private key from your .env file

	const myAccountId = process.env.MY_ACCOUNT_ID;
	const myPrivateKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);

	// If we weren't able to grab it, we should throw a new error
	if (myAccountId == null ||
        myPrivateKey == null) {
		throw new Error('Environment variables for account ID / PKs must be present');
	}

	const help = getArgFlag('h');
	if (help) {
		console.log('Usage: node associateToken.js -e [test|main] -t <tokenId> -a [ass|dis]');
		console.log('                -t <tokenId> tokenID or can be , seperated (no spaces)');
		console.log('                      e.g. 0.0.614759,0.0.614777,0.0.727536');
		// console.log(`Usage: node associateToken.js -e [test|main] [-t <tokenId>|-l <list>] -a [ass|dis]`);
		// console.log(`                              [-t <tokenId>|-l <list>] tokenID (can be , seperated) or file containing token per line`);
		console.log('                -a [ass|dis] associate or disassociate');
		process.exit(0);
	}
	const tokenId = getArg('t');
	const tokenListFile = getArg('l');
	const tokenList = [];
	if (tokenId === undefined && tokenListFile === undefined) {
		console.log('token ID or list required, run: node associateToken.js -h ');
		process.exit(1);
	}
	if (!tokenListFile === undefined) {
		// TODO: read in tokens
	}
	else {
		// check if tokens are comma seperated
		const commaList = tokenId.split(',');
		for (let i = 0; i < commaList.length; i++) {
			tokenList.push(commaList[i]);
		}
	}

	const action = getArg('a');
	let associate;
	if (action == 'ass') {
		associate = true;
	}
	else if (action == 'dis') {
		associate = false;
	}
	else {
		console.log('Need to specify ass(ociate) or dis(associate) -> run: node associateToken.js -h ');
		process.exit(1);
	}

	const env = getArg('e');
	if (env === undefined) {
		console.log('Environment required, specify test or main -> run: node associateToken.js -h ');
		process.exit(1);
	}

	verbose = getArgFlag('v');

	const force = getArgFlag('force');

	let tokenListString = '';
	for (let i = 0 ; i < tokenList.length; i++) {
		if (tokenListString == '') { tokenListString += `${tokenList[i]}`; }
		else { tokenListString += `, ${tokenList[i]}`; }
	}

	console.log(`action: ${action} on ${myAccountId} for tokens: ${tokenListString}`);


	// Create our connection to the Hedera network
	let client;
	if (env == 'main') {
		client = Client.forMainnet().setOperator(
			myAccountId,
			myPrivateKey,
		);
	}
	else if (env == 'test') {
		client = Client.forTestnet().setOperator(
			myAccountId,
			myPrivateKey,
		);
	}
	else {
		console.log('must specify -e with \'test\' or \'main\' -- no quotes!');
		return;
	}

	let tokenIdFromString;

	// run pre checks to allow bulk processing
	const checkedTokenList = [];
	for (let c = 0; c < tokenList.length; c++) {
		tokenIdFromString = TokenId.fromString(tokenList[c]);
		console.log(`pre-check: ${tokenIdFromString}`);

		//* *CHARGEABLE** consider moving to mirror nodes
		const ownedBalance = await checkAccountBalanaces(myAccountId, tokenIdFromString, client);
		if (associate) {
			if (ownedBalance >= 0) {
				// already countAssociated
				console.log(`Skipping: ${myAccountId} already has ${tokenIdFromString} associated`);
				continue;
			}
			else {
				checkedTokenList.push(tokenIdFromString);
			}
		}
		else if (ownedBalance < 0) {
			// already countAssociated
			console.log(`Skipping: ${myAccountId} already has ${tokenIdFromString} DISassociated`);
			continue;
		}
		else if (ownedBalance > 0 && !force) {
			console.log(`Skipping: ${myAccountId} still owns ${ownedBalance} -> ${tokenIdFromString} use -force to overide`);
			continue;
		}
		else {
			checkedTokenList.push(tokenIdFromString);
		}
	}


	if (checkedTokenList.length == 0) {
		console.log('No tokens passed the pre-check');
		process.exit(1);
	}


	let transaction;
	if (associate) {
		transaction = await new TokenAssociateTransaction()
			.setAccountId(myAccountId)
			.setTokenIds(checkedTokenList)
			.freezeWith(client)
			.sign(myPrivateKey);
	}
	else {
		// Dissociate a token from an account and freeze the unsigned transaction for signing
		transaction = await new TokenDissociateTransaction()
			.setAccountId(myAccountId)
			.setTokenIds(checkedTokenList)
			.freezeWith(client)
			.sign(myPrivateKey);
	}

	const tokenTransferSubmit = await transaction.execute(client);
	const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);

	console.log('The transaction consensus status is ' + tokenTransferRx.status.toString());

	console.log('Running verification:');
	for (let z = 0; z < checkedTokenList.length; z++) {
		await checkAccountBalanaces(myAccountId, checkedTokenList[z], client, z ? 0 : true, false);
	}

	process.exit(0);
}

async function checkAccountBalanaces(accountId, tokenId, client, force = false) {
	// Save multiple transactions byt using a Map of existing results
	// force option to get an update
	let tokenMap = accountTokenOwnershipMap.get(accountId) || null;
	if (tokenMap == null || force) {
		const balanceCheckTx = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
		tokenMap = balanceCheckTx.tokens._map;
		console.log(`Found ${tokenMap.size} unquie associated tokens`);
	}

	const ownedBalance = tokenMap.get(`${tokenId}`) || -1;

	if (verbose) {
		tokenMap.forEach((key, value) => {
			console.log(key, value);
		});
	}

	// console.log(tokenId, balanceCheckTx.tokens);
	if (ownedBalance < 0) {
		console.log(`- ${accountId} does not have ${tokenId} associated`);
	}
	else {
		console.log(`- ${accountId} balance: ${ownedBalance} NFT(s) of ID ${tokenId}`);
	}
	return ownedBalance;
}

main();
