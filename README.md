# hedera-nft-scripts
Series of scripts for interacting with Hedera NFTs

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