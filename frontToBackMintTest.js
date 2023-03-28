require('dotenv').config();
const {
	AccountId,
	PrivateKey,
	Client,
	TokenMintTransaction,
	TransactionId,
	Transaction,
} = require('@hashgraph/sdk');

const env = process.env.ENVIRONMENT || null;

async function main() {
	const feUser = AccountId.fromString(process.env.FE_USER_ID);
	const feKey = PrivateKey.fromString(process.env.FE_PRIVATE_KEY);

	console.log('- Using ENVIRONMENT:', env);
	console.log('- Using FE User:', feUser.toString());

	let feClient;
	let beClient;
	if (env == 'TEST') {
		feClient = Client.forTestnet();
		beClient = Client.forTestnet();
		console.log('Minting *TESTNET*');
	}
	else if (env == 'MAIN') {
		feClient = Client.forMainnet();
		beClient = Client.forMainnet();
		console.log('Minting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	feClient.setOperator(feUser, feKey);

	const nodeId = [];
	nodeId.push(new AccountId(3));

	// prepare a new token mint transation
	const tokenMintTx = new TokenMintTransaction()
		.setTokenId(process.env.NFT_TOKEN_ID)
		.addMetadata(Buffer.from(''))
		.setNodeAccountIds(nodeId)
		.setTransactionId(TransactionId.generate(feUser))
		.setTransactionMemo('Mint NFT FE to BE')
		.freeze();

	// sign the transaction as FE user
	const feSignedTx = await tokenMintTx.sign(feKey);

	// serialize the transaction
	const txAsBytes = feSignedTx.toBytes();
	const txBytesAsBase64 = Buffer.from(txAsBytes).toString('base64');

	// output the serialized transaction
	console.log('Serialized transaction:', txBytesAsBase64);

	// deserialize the transaction to a new object
	const beTx = Transaction.fromBytes(Uint8Array.from(Buffer.from(txBytesAsBase64, 'base64')));

	// sign with the supply key
	beTx.sign(PrivateKey.fromString(process.env.NFT_SUPPLY_KEY));
	console.log('Signed with Supply key');

	// submit the transaction using a different client
	const beUser = AccountId.fromString(process.env.BE_USER_ID);
	const beKey = PrivateKey.fromString(process.env.BE_PRIVATE_KEY);

	console.log('- Using BE User:', beUser.toString());

	beClient.setOperator(beUser, beKey);
	const txResult = await beTx.execute(beClient);
	const mintRx = await txResult.getReceipt(beClient);

	console.log('Result', mintRx.status.toString(), 'serials', mintRx.serials.toString());
}

main().then(() => console.log('Complete')).catch((err) => console.error(err));