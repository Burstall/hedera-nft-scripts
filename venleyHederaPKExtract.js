const axios = require('axios');
const { inspect } = require('util');
const readlineSync = require('readline-sync');

/*
Once the script runs it will prompt you for 3 inputs;
# - pincode: your PIN
# - WalletID: the walletID you are trying to export, check the URL of your wallet in Venly to find it [format: 9eXXX2b-XXXX-XXXX-XXXX-XXXXXXXX441]
# - bearer token: the authentication token -> Hedera wallet in Venly --> right click --> Inspect--> Network tab--> Fetch/XHR--> Headers -> Authorization: Bearer (long string copy/paste)
*/

(async () => {
	// read in the pincode
	const pincode = readlineSync.question('Enter pincode: ', { hideEchoBack: true });
	// read in wallet address
	const walletAddress = readlineSync.question('Enter wallet address: ');
	// read in bearer token
	const bearerToken = readlineSync.question('Enter bearer token: ', { hideEchoBack: true });

	const url = `https://api-wallet.venly.io/api/wallets/${walletAddress}/export`;

	const proceed = readlineSync.keyInYNStrict('Are you sure you want to export the private key?');
	if (!proceed) {
		console.log('Aborting');
		process.exit(1);
	}

	const headers = {
		'Authorization': `Bearer ${bearerToken}`,
		'Content-Type': 'application/json',
	};

	const body = {
		'pincode': pincode,
		'type': 'PRIVATE_KEY',
	};

	const response = await axios.post(url, body, { headers: headers });
	console.log(inspect(response.data));

})().catch(err => {
	console.log(err);
	process.exit(1);
});