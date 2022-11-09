import { Client, PrivateKey, AccountBalanceQuery, TokenId, AccountInfoQuery } from '@hashgraph/sdk';
import dotenv from 'dotenv';
dotenv.config();

let env;

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
		console.log('Usage: node accountInfo.mjs -e [test|main] -t <tokenId> -acc <account>');
		process.exit(0);
	}
	const tokenId = getArg('t');
	const tokenListFile = getArg('l');
	const tokenList = [];
	if (tokenId === undefined && tokenListFile === undefined) {
		console.log('token ID or list required, run: node accountInfo.mjs -h ');
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

	env = getArg('e');
	if (env === undefined) {
		console.log('Environment required, specify test or main -> run: node accountInfo.mjs -h ');
		process.exit(1);
	}

	verbose = getArgFlag('v');

	let acct = myAccountId;
	if (getArgFlag('acc')) {
		acct = getArg('acc');
	}

	let tokenListString = '';
	for (let i = 0 ; i < tokenList.length; i++) {
		if (tokenListString == '') { tokenListString += `${tokenList[i]}`; }
		else { tokenListString += `, ${tokenList[i]}`; }
	}

	console.log(`Checking ${acct} for tokens: ${tokenListString}`);


	// Create our connection to the Hedera network
	let client;
	if (env.toLowerCase() == 'main') {
		client = Client.forMainnet().setOperator(
			myAccountId,
			myPrivateKey,
		);

		env = 'MAIN';
	}
	else if (env.toLowerCase() == 'test') {
		client = Client.forTestnet().setOperator(
			myAccountId,
			myPrivateKey,
		);

		env = 'TEST';
	}
	else {
		console.log('must specify -e with \'test\' or \'main\' -- no quotes!');
		return;
	}

	let tokenIdFromString;

	for (let c = 0; c < tokenList.length; c++) {
		tokenIdFromString = TokenId.fromString(tokenList[c]);
		console.log(`check: ${tokenIdFromString}`);

		await checkAccountBalances(acct, tokenIdFromString, client);

	}

}

async function checkAccountBalances(accountId, tokenId, client) {
	const acctInfoTx = await new AccountInfoQuery().setAccountId(accountId).execute(client);
	console.log('Account Infor:\n', JSON.stringify(acctInfoTx, null, 4));


	const balanceCheckTx = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
	const tokenMap = balanceCheckTx.tokens._map;
	console.log(`Found ${tokenMap.size} unique associated tokens`);

	// console.log(JSON.stringify(balanceCheckTx, null, 4));

	const ownedBalance = tokenMap.get(`${tokenId}`) || -1;

	// console.log(tokenId.toString(), JSON.stringify(balanceCheckTx.tokens[tokenId.toString()], null, 4));

	if (verbose) {
		tokenMap.forEach((key, value) => {
			console.log(key, value);
		});
	}

	// console.log(tokenId, balanceCheckTx.tokens);
	if (ownedBalance < 0) {
		console.log(`- NETWORK ${accountId} does not have ${tokenId} associated`);
	}
	else {
		console.log(`- NETWORK ${accountId} balance: ${ownedBalance} NFT(s) of ID ${tokenId}`);
	}

	return ownedBalance;
}

main();
