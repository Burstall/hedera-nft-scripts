# hedera-nft-scripts
Series of scripts for interacting with Hedera NFTs

Everytime you pull updates from the repository please run from the terminal:

npm install

----

Get Token Info
Used to get basic information about a token [and can pull metadata]

Usage: node getTokenInfo.mjs -t <token> [-v] [-swap] [-testnet] [-s <serial>] [-img]
       -t <token>
       -s <serial>
       -img    gets images only
       -swap   swaps out line breaks in metadata found
       -testnet
       -v          verbose [debug]

----

Check Ownership
Used to query ownership of tokens and produce audit snapshots.

Usage: node checkOwnership.mjs [-w <wallet> [-zero]] [-t <token> [-s <serials>] -ex <wallet>] [-r] [-audit] [-auditserials [-hodel [-epoch XXX]]] [-v] [-version]
       -w <wallet> if not specified will look for all wallets on token
             -zero  only show zero balances for wallet specified
       -t <token>  if not specified look for all tokens in given wallet
       -ex <wallet> 0.0.XXXX,0.0.YYYY to exclude wallets from display
       -threshold   minimum ownership [default: 1]
       -r          show token royalties
       -s <serials> check wallets onwning specified serials
                    (comma seperated or - for range e.g. 2,5,10 or 1-10)
       -audit      a simple token ownership audit output - saves to file
       -auditserials  a simple *serials* ownership audit output - saves to file
       -hodl       used with auditserials to get hodl data per serial
       -epoch XXXX used with hodl to exclude anyoe buying post date/time
       -v          verbose [debug]

----

Associate/Disassociate Tokens
Allows multiple association / disassociation of tokens in a single transaction form the command line

.env file (rename .env.example to .env if you like) with the following items:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=

Usage: node associateToken.js -e [test|main] -t <tokenId> -a [ass|dis]
                -t <tokenId> tokenID or can be , seperated (no spaces)
                      e.g. 0.0.614759,0.0.614777,0.0.727536
                -a [ass|dis] associate or disassociate

-----

Create Fungible Token:
Used to create a new fungible token.

Requires:
.env file (rename .env.example to .env if you like) with the following items (example values can be deleted)
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
###Fungible Token Creation###
TOKEN_NAME=Airdrop Test FT
TOKEN_SYMBOL=ADTFT
TOKEN_DECIMALS=6
TOKEN_INITALSUPPLY=100000

**initial supply is net of the decimal e.g. above supply created is 0.1 ADTFT**

Usage: node createFungibleToken.mjs [-mainnet] [-adminkey] [-freezekey] [-pausekey] [-maxsupply XXX]
       -mainnet         optional - defaults to testnet unless specified
       -adminkey        optional - add an admin key
       -freezekey       optional - add a freeze key
       -pausekey        optional - add an pause key
       -maxsupply       optional - if used please provide an integer, if omitted then infinite supply assumed

----

Mint additional FT:
Used to add supply

Requires:
.env file (rename .env.example to .env if you like) with the following items (example values can be deleted)
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
###Mint additional Fungible Tokens##
FT_TOKEN_ID=
FT_SUPPLY_KEY=

Usage: node mintAdditionalFungibleTokens.mjs [-mainnet] -supply XXX

----

Burn NFT
Simple script to allow the burning of NFTs [when you hold the supply key]
**N.B. serial must be in treasury account to burn else -? TREASURY_MUST_OWN_BURNED_NFT error**

.env file (rename .env.example to .env if you like) with the following items:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
ENVIRONMENT=
SUPPLY_KEY=
TOKEN_ID=

Usage: node burnNFT.js -s <serials>
       -s <serials> burn specified serials
                    (singular, comma seperated or - for range e.g. 2,5,10 or 1-10)

----

Burn FT
Simple script to allow the burning of FTs [when you hold the supply key]
**N.B. supply must be in treasury account to burn**

.env file (rename .env.example to .env if you like) with the following items:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
ENVIRONMENT=
SUPPLY_KEY=
TOKEN_ID=

Usage: node burnFT.js -amt XXX
       -amt     XXXX to burn
					
----

Freeze NFT
Simple script to freeze a token for an account.
**Requires FREEZE Key to be set at time of mint**

**This allows the creator to make tokens 'soulbound' as soon as sent then run freezeNFT to make it soulbound**

.env file (rename .env.example to .env if you like) with the following items:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
ENVIRONMENT=
FREEZE_KEY=
TOKEN_ID=

Usage: node freezeNFT.js -acc <wallet> [-unfreeze]
           -acc <wallet>  this is the wallet address to free/unfreeze
           -unfreeze      if specified will unfreeze wallet (default: freeze operation)

----

NFTTransferTwoPKs
Script to transfer all serials of a given token from one account to another when you have both keys. Useful when sender account is not treasury e.g. from a burner 3rd party account or between wallets you owns. Exposes minimal economics (0.001 per batch of up to 8 NFTs) to cirumvent royalties / fall back fees.

.env file (rename .env.example to .env if you like) with the following items:
###NFTTransferTwoPKs
SENDER_ACCOUNT_ID=
SENDER_PRIVATE_KEY=
RECEIVE_ACCOUNT_ID=
RECEIVE_PRIVATE_KEY=
MEMO='Example Memo'
##MAIN or TEST environment
ENVIRONMENT=

Usage: node NFTTransferTwoPKs.mjs -t <token> [-v]

----

updatePrivateKey
Script to update the Private Key on an account. Hopefully you do not need to do this very often but if/when you do, good to have in your toolbox. I would encoruage people to try it on a testnet account first just to ensure you are familiar and to use the -test argument [this does everything except try to update it on Hedera side so you can see how it works.]

**Reminder: whenever new scripts appear good to run 'npm install' to ensure all prequesite libraries are installed.**


MY_ACCOUNT_ID=0.0.1111
MY_PRIVATE_KEY=
##MAIN or TEST environment
ENVIRONMENT=TEST
UPDATE_ACCT=0.0.222
OLD_KEY=

**N.B. MY_ACCOUNT_ID is the account paying for the transaction. This can be the same account you are changing the key for but it does not have to be.**

**UPDATE_ACCT= and OLD_KEY= can be left empty and you may supply them as arguments: node updatePrivateKey.js -acc 0.0.222 -pk 302XXXXXXXXXXXXXXXXX3C**

**The script does not force you to save to a file but this is safest, use -save to output the new key to a file you can use -save to overide the name of the file. If you do not it will ask you for input one last time regarding saving so do not be surprised**

Usage: Usage: node updatePrivateKey.js [-acc <account>] [-pk <private key>] [-save [<file-name>]] [-test]
       -acc <account>           supply account to reset on commandline
        **If not supplied will look for UPDATE_ACCT in .env **
       -pk <private key>        supply private key to reset on commandline
        **If not supplied will look for OLD_KEY in .env **
       -save                            use -save to save the *NEW* PK to file
        **Supresses console output**
       -save <filename> to specify the file to save to
       -test                            run script without changing key
        **Changing keys is scary - this lets you be double sure connfig looks right**

---

trackHederaNFTs.js

Scans for **ALL** NFTs on the network and tracks which wallets own what balances. Used to try and assess number of users / collectors on the network through time. It's not fast but it does keep you updated on progress.

Usage: node trackHederaNFTs.js

---

convertNFTexportioToTMTMetadata.js

Basic script to show maniuplation and conversion of JSON objects. In this case converting from NFTexport.io metadata format to something more friendly for minting on Hedera with TMT or equivalent

.env settings (can be adjust with command line arguments too)
###Metadata Conversion
COLLECTION_WEBSITE=
COLLECTION_COMPILER=
COLLECTION_CREATOR=
COLLECTION_LOGO=
COLLECTION_CATEGORY=
COLLECTION_DESC=

Usage: node convertNFTexportioToTMTMetadata.js -process <file> [-website <url>] [-compiler <name>] [-creator <creator>] [-logo <CID>] [-category <category>][-desc 'description here'
       -process file to read in and process
       -website project url - optional
       -compiler        compiler text - optional
       -creator creator text - optional
       -logo    Pinned CID for a logo jpg image
       -category        category text - optional
       -desc    compiler text - optional

---

createNFT.js

Start of a set of minting tools. This is 'step 1' (see below) of creating the token ID with 0 serials ready to mint.

Planning a three step process for command line minting scripts:
1) token create (set royalties / name / supply etc.) -> returns supply key / token ID
2) pin images and resulting metadata on IPFS
3) mint the NFTs using the pinned metadata

Usage: node createNFT.js [-wipe] [-admin] [-freeze] [-save] [-royalty <XXX.json>]
                [-name AAA] [-symbol WWW] [-desc 'short max 100 char description here'] [-max M] [-feecap Q]
       -wipe    add a wipe key
       -admin   add a admin key
       -freeze  add a freeze key
       -pause   add a pause key
       -royalty XXX.json        path to .json file containing royalties if applicable
       -save    save keys to file on completion
       -feecap Q where Q is the max HBAR spend (defaults to 50h)
       -name    token name
       -symbol  token symbol
       -desc    token description
       -max     maxSupply

.env settings:
#mint NFT Token
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
NFT_NAME=
NFT_SYMBOL=
NFT_DESC=
NFT_MAX_SUPPLY=

Per the usage pattern you can override NFT details on the command line if needed otherwise it will use values from the .env

pass in the royalty .json file with -royalty (optional) -> see **royalties_example.json** for a guide.

the script will read in the information and present you with a summary asking for confirmation to attempt the token create. once complete the script will ask if you wish to have the details & keys saved to file (highly recommended) - if not / on failure it will print to console.

---

mintNFTfromPinnedMetadata.js

This is 'step 3' (see above) -> NFT minting script if you have already pinned the metatdata.json file into IPFS and created the token. Designed to track status and be replayable in case of failure during the minting process.

Usage: node mintNFTfromPinnedMetadata.js -process <file>
       -process json file to read in and process
                File format: 
        { 
                "ipfs://XXXX/metadata.json", 
                "ipfs://YYYY/metadata.json", 
                "ipfs://ZZZZ/metadata.json"  
        }
or (output format of this script that includes tracking)

        {
                "0: {
                        "cid": "ipfs://XXXX/metadata.json",
                        "minted": true,
                        "serial": "629"
                },
                "1": {
                        "cid": "ipfs://YYY/metadata.json",
                        "minted": false,
                },
                "2": {
                        "cid": "ipfs://ZZZZ/metadata.json",
                }
        }

.env settings:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
ENVIRONMENT=
NFT_TOKEN_ID=
NFT_SUPPLY_KEY=
#batch size defaults to 10 which is the maximum if missing / no value
NFT_MINT_BATCH_SIZE=

----

tokenGraveyard.js

Interaction script to use the token graveyard. Works in MAIN & TEST environements to help unclog your wallet of failed mints where you can't grab the supply key. 

Cost -> there is a nominal cost to associate a new token (default: 5 hbar + association fee & you can check the live cost with the -cost option) of course if feeling generous you cna override the payment to be higher with -pay option. You can of course deploy your own copy given the repo is freely available however it may cost you more to do that :D

Usage: node tokenGraveyard.js [-associate 0.0.XXX | -cost] [-pmt Z]
       -associate 0.0.XXX       specify the token to associate for the graveyard
       -cost                            query the minimum cost of the service
       -pay Z                           override the default payment for usage

.env settings:
MY_ACCOUNT_ID=
MY_PRIVATE_KEY=
ENVIRONMENT=