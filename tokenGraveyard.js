const {
	Hbar,
	Client,
	AccountId,
	PrivateKey,
	ContractFunctionParameters,
	ContractExecuteTransaction,
	TokenId,
	ContractId,
	HbarUnit,
	ContractCallQuery,
	// eslint-disable-next-line no-unused-vars
	TransactionReceipt,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
require('dotenv').config();
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();

const CONTRACT_ID_TESTNET = ContractId.fromString('0.0.48287676');
const CONTRACT_ID_MAINNET = ContractId.fromString('0.0.1279390');
const DEFAULT_COST = new Hbar(5);

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.MY_ACCOUNT_ID);
const env = process.env.ENVIRONMENT ?? null;

let client;
let contractId;
let payment;
let abi;

async function main() {
	if (getArgFlag('h')) {
		console.log('Usage: node tokenGraveyard.js [-associate 0.0.XXX | -cost] [-pmt Z]');
		console.log('       -associate 0.0.XXX	specify the token to associate for the graveyard');
		console.log('       -cost				query the minimum cost of the service');
		console.log('       -pay Z    			override the default payment for usage');
		process.exit(0);
	}

	if (getArgFlag('pay')) {
		payment = new Hbar(getArg('pay'), HbarUnit.Hbar);
	}
	else {
		payment = DEFAULT_COST;
	}

	if (!operatorKey || !operatorId) {
		console.log('ERROR: Must specify ACCOUNT_ID & PRIVATE_KEY in .env file');
		process.exit(1);
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		contractId = CONTRACT_ID_TESTNET;

	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		contractId = CONTRACT_ID_MAINNET;
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);

	const json = JSON.parse(fs.readFileSync('./abi/TokenGraveyard.json', 'utf8'));
	abi = json.abi;

	console.log('\n-Loading ABI...\n');
	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract: ',
		contractId.toString(),
		' / ', contractId.toSolidityAddress());

	// either -cost or -token needs specification
	if (getArgFlag('cost')) {
		try {
			console.log('\n-getCost Query');
			// generate function call with function name and parameters
			const functionCallAsUint8Array = encodeFunctionCall('getCost', []);

			// query the contract
			const contractCall = await new ContractCallQuery()
				.setContractId(contractId)
				.setFunctionParameters(functionCallAsUint8Array)
				.setMaxQueryPayment(new Hbar(2))
				.setGas(100000)
				.execute(client);

			const results = decodeFunctionResult('getCost', contractCall.bytes);

			console.log('Cost to associate a new token for burial:', new Hbar(results.amt, HbarUnit.Tinybar).toString());
		}
		catch (err) {
			console.log(JSON.stringify(err, null, 4));
		}
	}
	else if (getArgFlag('associate')) {
		const tokenId = TokenId.fromString(getArg('associate'));
		console.log('\n-Associate token:', tokenId.toString());

		if (!readlineSync.keyInYNStrict('\nReady to prepare the burial site? Once associated send the tokens to the contract using any method you prefer', contractId.toString())) {
			console.log('**User Aborted - exiting**');
			process.exit(0);
		}

		try {
			console.log('\n-Attempting to associate token');
			const gasLim = 800000;
			const params = new ContractFunctionParameters()
				.addAddress(tokenId.toSolidityAddress());
			const [associateRx] = await contractExecuteFcn(contractId, gasLim, 'tokenAssociate', params, payment);
			// console.log('Function results', JSON.stringify(contractOutput, 3));
			const associateStatus = associateRx.status;

			console.log('\n-Association: ' + associateStatus.toString());
		}
		catch (err) {
			console.log(err);
		}
	}
	else {
		console.log('Must specify either -cost (check cost) or -associate 0.0.XXX to use the script.');
		process.exit(1);
	}
}

/**
 * Helper function to encapsulate the calling of a SC method
 * @param {ContractId} cId the SC to call
 * @param {number} gasLim the upper limit for gas to use
 * @param {string} fcnName the name of the function to call
 * @param {ContractFunctionParameters} params parameters for the function
 * @param {Hbar} amountHbar amount of hbar to pay for the service
 * @returns {[TransactionReceipt, any]} the transaction reciept and the decoded function result
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	// console.log('record bytes:', JSON.stringify(record.contractFunctionResult.bytes, 4));
	// console.log('Execution return', fcnName, JSON.stringify(contractExecuteTx, 3));
	record.contractFunctionResult.logs.forEach((log) => {
		if (log.data == '0x') return;

		// convert the log.data (uint8Array) to a string
		const logStringHex = '0x'.concat(Buffer.from(log.data).toString('hex'));

		// get topics from log
		const logTopics = [];
		log.topics.forEach((topic) => {
			logTopics.push('0x'.concat(Buffer.from(topic).toString('hex')));
		});

		// decode the event data
		const event = decodeEvent('GraveyardEvent', logStringHex, logTopics.slice(1));

		if (event) {
			// output the from address stored in the event
			let outputStr = '\n';
			for (let f = 0; f < event.__length__; f++) {
				const field = event[f];
				let output = field.startsWith('0x') ? AccountId.fromSolidityAddress(field).toString() : field;
				output = f == 0 ? output : ' : ' + output;
				outputStr += output;
			}

			console.log(outputStr);
		}
		else {
			console.log('ERROR decoding (part of) log message');
		}

	});

	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults];
}

/**
 * Helper method to decode emitted events taken from transaction record
 * @param {string} eventName name of the event expected to be emitted
 * @param {string} log log as a Hex string
 * @param {string[]} topics topic data as array
 * @returns {any} the decoded event object
 */
function decodeEvent(eventName, log, topics) {
	const eventAbi = abi.find((event) => event.name === eventName && event.type === 'event');
	try {
		const decodedLog = web3.eth.abi.decodeLog(eventAbi.inputs, log, topics);
		return decodedLog;
	}
	catch (err) {
		console.log('ERROR decoding event', eventName, log, topics, JSON.stringify(err, null, 4));
	}
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

/**
 * Helper function to encode a function call
 * @param {string} functionName name of function to call
 * @param {string[]} parameters array of parameters to the function call - typically empty
 * @returns {Buffer} function call encoded as a Unit8 Array ready to send
 */
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Helper method to search command line arguments for a given flag eg -t 0.0.XXX
 * to get token 0.0.XXX as a string
 * @param {string} arg the argument to look for
 * @returns {string} argument following the flag
 */
function getArg(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customIndex > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customIndex + 1];
	}

	return customValue;
}

/**
 * Helper method to search command line arguments for a given flag eg -h as a help switch
 * @param {string} arg the argument to look for
 * @returns {boolean} flag found
 */
function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

main();