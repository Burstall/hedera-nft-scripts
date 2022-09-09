require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenCreateTransaction,
	TokenType,
	Hbar,
	TokenSupplyType,
	CustomRoyaltyFee,
	CustomFixedFee,
	HbarUnit,
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const fs = require('fs');

const SUPPLY_KEY = 'Supply';
const ADMIN_KEY = 'Admin';
const WIPE_KEY = 'Wipe';
const FREEZE_KEY = 'Freeze';
const PAUSE_KEY = 'Pause';

const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const env = process.env.ENVIRONMENT ?? null;
// treasury has to sign, using operator as default
// auto renew has ot sign, not enabled yet but again safer to use single account as operator, treasury and autorenew
let tsry = process.env.MY_ACCOUNT_ID;
let autoRenew = process.env.MY_ACCOUNT_ID;
let nftName = process.env.NFT_NAME;
let nftSymbol = process.env.NFT_SYMBOL;
let nftDesc = process.env.NFT_DESC;
let nftMaxSupply = process.env.NFT_MAX_SUPPLY;
let maxHbarFee = 50;

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'http://testnet.mirrornode.hedera.com';

function getArg(arg) {
	const customidx = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customidx > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customidx + 1];
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
	if (getArgFlag('h')) {
		console.log('Usage: node createNFT.js [-wipe] [-admin] [-freeze] [-save] [-royalty <XXX.json>]');
		console.log('\t\t[-name AAA] [-symbol WWW] [-desc \'short max 100 char description here\'] [-max M] [-feecap Q]');
		console.log('       -wipe	add a wipe key');
		console.log('       -admin	add a admin key');
		console.log('       -freeze	add a freeze key');
		console.log('       -pause	add a pause key');
		console.log('       -royalty XXX.json	path to .json file containing royalties if applicable');
		console.log('       -save	save keys to file on completion');
		console.log('       -feecap Q where Q is the max HBAR spend (defaults to 50h)');
		console.log('       -name	token name');
		console.log('       -symbol	token symbol');
		console.log('       -desc	token description');
		console.log('       -max	maxSupply');
		process.exit(0);
	}

	// read in the token parameters and overides
	if (getArgFlag('tsry')) tsry = getArg('tsry');
	if (getArgFlag('autorenew')) autoRenew = getArg('autorenew');
	if (getArgFlag('name')) nftName = getArg('name');
	if (getArgFlag('symbol')) nftSymbol = getArg('symbol');
	if (getArgFlag('desc')) nftDesc = getArg('desc');
	if (getArgFlag('max')) nftMaxSupply = Number(getArg('max'));
	if (getArgFlag('feecap')) maxHbarFee = Number(getArg('feecap'));

	// if treasury is empty then operator account used
	if (!tsry) tsry = operatorId.toString();
	// auto renew empty then set to treasury
	if (!autoRenew) autoRenew = tsry;

	const addWipe = getArgFlag('wipe');
	const addAdmin = getArgFlag('admin');
	const addFreeze = getArgFlag('freeze');
	const addPause = getArgFlag('pause');
	let save = getArgFlag('save');

	const keyMap = new Map();
	keyMap.set(SUPPLY_KEY, PrivateKey.generate());

	if (addWipe) keyMap.set(WIPE_KEY, PrivateKey.generate());
	if (addAdmin) keyMap.set(ADMIN_KEY, PrivateKey.generate());
	if (addFreeze) keyMap.set(FREEZE_KEY, PrivateKey.generate());
	if (addPause) keyMap.set(PAUSE_KEY, PrivateKey.generate());

	// read in the royalty file
	const royaltiesObj = [];
	let royaltiesAsString = '\n\n';

	if (getArgFlag('royalty')) {
		// read in the file specified
		const fileToProcess = getArg('royalty');
		let royaltiesJSONAsString;
		try {
			royaltiesJSONAsString = fs.readFileSync(fileToProcess, 'utf8');
		}
		catch (err) {
			console.log(`ERROR: Could not read file (${fileToProcess})`, err);
			process.exit(1);
		}

		// parse JSON
		let royaltyObjFromFile;
		try {
			royaltyObjFromFile = JSON.parse(royaltiesJSONAsString);
		}
		catch (err) {
			console.log('ERROR: failed to parse the specified JSON', err, royaltyObjFromFile);
			process.exit(1);
		}

		for (const idx in royaltyObjFromFile) {
			const fee = new CustomRoyaltyFee();
			const royalty = royaltyObjFromFile[idx];
			// console.log('Processing custom fee:', royalty);
			if (royalty.percentage) {
				// ensure collector account
				if (!royalty.account) {
					console.log('ERROR: Royalty defined as ' + royalty.percentage + ' but no account specified', royalty.account);
					process.exit(1);
				}
				fee.setNumerator(royalty.percentage * 100)
					.setDenominator(10000)
					.setFeeCollectorAccountId(royalty.account);
				royaltiesAsString += 'Pay ' + royalty.percentage + '% to ' + royalty.account;
			}

			if (royalty.fbf) {
				fee.setFallbackFee(
					new CustomFixedFee().setHbarAmount(new Hbar(royalty.fbf)),
				);
				royaltiesAsString += ' with Fallback of: ' + royalty.fbf + 'hbar\n';
			}
			else {
				royaltiesAsString += ' NO FALLBACK\n';
			}
			royaltiesObj.push(fee);
		}
	}

	// summarise the data to the user

	console.log(`- Using account: ${operatorId} as payer/treasury/autorenew`);
	console.log('- Using ENIVRONMENT:', env);
	console.log('- Max Fee: (h)', maxHbarFee);

	if (tsry != operatorId.toString()) {
		console.log('*WARNING* Treasury and paying account are different', tsry, operatorId.toString());
		console.log('Treasury account must sign too - exiting');
		process.exit(1);
	}
	if (tsry != autoRenew) console.log('*WARNING* Treasury and autorenew account are different', tsry, autoRenew);

	console.log('- Using keys:', keyMap.keys());

	let tokenDetails = 'Name:\t' + nftName +
						'\nSymbol:\t' + nftSymbol +
						'\nDesc:\t' + nftDesc +
						'\nTreasury:\t' + tsry +
						'\nAuto Renew:\t' + autoRenew +
						'\nMax Supply:\t' + nftMaxSupply;

	if (royaltiesObj.length > 0) tokenDetails += royaltiesAsString;
	else tokenDetails += '\nNO ROYALTIES SET\n';

	console.log(tokenDetails);

	// take user input
	const execute = readlineSync.keyInYNStrict('Do wish to create the token?');

	if (!execute) {
		console.log('User aborted');
		process.exit(0);
	}

	let client;
	if (env == 'TEST') {
		client = Client.forTestnet();
		console.log('Mint tokens in *TESTNET*');
	}
	else if (env == 'MAIN') {
		client = Client.forMainnet();
		console.log('Mint tokens in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const tokenCreateTx = new TokenCreateTransaction()
		.setTokenType(TokenType.NonFungibleUnique)
		.setTokenName(nftName)
		.setTokenSymbol(nftSymbol)
		.setTokenMemo(nftDesc)
		.setInitialSupply(0)
		.setMaxSupply(nftMaxSupply)
		.setSupplyType(TokenSupplyType.Finite)
		.setTreasuryAccountId(AccountId.fromString(tsry))
		.setAutoRenewAccountId(AccountId.fromString(autoRenew))
		.setSupplyKey(keyMap.get(SUPPLY_KEY))
		.setMaxTransactionFee(new Hbar(maxHbarFee, HbarUnit.Hbar));

	if (addAdmin) {
		tokenCreateTx.setAdminKey(keyMap.get(ADMIN_KEY));
	}
	if (addFreeze) {
		tokenCreateTx.setFreezeKey(keyMap.get(FREEZE_KEY));
	}
	if (addWipe) {
		tokenCreateTx.setFreezeKey(keyMap.get(WIPE_KEY));
	}
	if (addPause) {
		tokenCreateTx.setFreezeKey(keyMap.get(PAUSE_KEY));
	}

	// add royalties if needed
	if (royaltiesObj.length > 0) tokenCreateTx.setCustomFees(royaltiesObj);

	tokenCreateTx.freezeWith(client);

	const signedTx = await tokenCreateTx.sign(operatorKey);

	if (addAdmin) await signedTx.sign(keyMap.get(ADMIN_KEY));

	/*  submit to the Hedera network */
	const executionResponse = await signedTx.execute(client);

	/* Get the receipt of the transaction */
	const createTokenRx = await executionResponse.getReceipt(client).catch((e) => {
		console.log(e);
		console.log('Token Create **FAILED*');
		process.exit(1);
	});

	/* Get the token ID from the receipt */
	const tokenId = createTokenRx.tokenId;

	console.log('TOKEN MINTED:', tokenId.toString());

	// check if user wants to save the PK to file
	if (!save) {
		save = readlineSync.keyInYNStrict('Do you want to save token details to file (including keys)?\n**HIGHLY RECOMMENDED as if lost the token cannot be minted to**');
	}

	let outputString = 'Token ID:\t' + tokenId + '\n';


	const keys = Array.from(keyMap.keys());
	for (const k in keys) {
		const key = keys[k];
		outputString += keyMap.get(key) ? '\n' + key + ' Key:\t' + keyMap.get(key) : '';
	}

	const tokenUrl = env == 'MAIN' ? baseUrlForMainnet + '/api/v1/tokens/' + tokenId : baseUrlForTestnet + '/api/v1/tokens/' + tokenId;

	outputString += '\n\n' + tokenDetails +	'\n\n' + tokenUrl;

	if (save) {
		try {
			const startTime = new Date();
			const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
			const filename = `./${tokenId.toString().replaceAll('.', '-')}-mint-details-keys-${timestamp}.txt`;

			fs.writeFile(filename, outputString, { flag: 'w' }, function(err) {
				if (err) {return console.error(err);}
				// read it back in to be sure it worked.
				fs.readFile(filename, 'utf-8', function(err) {
					if (err) {
						console.log('Reading file failed -- printing to console');
						console.log(outputString);
					}
					console.log('Token details file created', filename);
				});
			});
		}
		catch (err) {
			// If we fail to write it then spit out the values to command line so not lost
			console.log('Error writing file -- bailing', err);

			console.log(outputString);
			process.exit(1);
		}
	}
	else {
		console.log(outputString);
	}
}

main();