import SafeApiKit from '@safe-global/api-kit';
import { ChannelId, sendMessage } from '../interactions/send-message';
import fs from 'fs';

const treasuryAddresses: Record<number, string> = {
    1: '0xea06e1b4259730724885a39CE3ca670eFB020E26',
    10: '0x2a185C8A3C63d7bFe63aD5d950244FFe9d0a4b60',
    146: '0xc5E0250037195850E4D987CA25d6ABa68ef5fEe8',
};

const blockexplorerUrls: Record<number, string> = {
    1: 'https://etherscan.io/tx/',
    10: 'https://optimistic.etherscan.io/tx/',
    146: 'https://sonicscan.org/tx/',
};

const chainIdToName: Record<number, string> = {
    1: 'Ethereum',
    10: 'Optimism',
    146: 'Sonic',
};

export async function scheduleTreasuryNotifications() {
    console.log('Schedule treasury notifications');
    // await sendTreasuryNotifications();
    // every 1hrs
    setInterval(sendTreasuryNotifications, 60 * 60 * 1000);
}

export async function sendTreasuryNotifications() {
    console.log('Checking and updating treasury notifications');
    // load latest processed noce from json file latestNonceTreasury.json
    const latestNonces = JSON.parse(fs.readFileSync('./src/crons/latestNonceTreasury.json', 'utf-8')) as Record<
        string,
        number
    >;

    const newTransactions: {
        chainId: string;
        txHash: string;
        note: string;
    }[] = [];

    // for each treasury address, fetch the latest transactions from the safe sdk
    for (const [chainId, treasuryAddress] of Object.entries(treasuryAddresses)) {
        const apiKit = new SafeApiKit({
            chainId: BigInt(chainId),
            apiKey: process.env.SAFE_API_KEY,
        });

        if (!apiKit) {
            throw new Error('Failed to initialize API Kit');
        }

        const options = {
            executed: true,
            ordering: 'created',
            limit: 100,
            offset: latestNonces[chainId] + 1,
        };
        const multisigTxs = await apiKit.getMultisigTransactions(treasuryAddress, options);

        let latestNonce = latestNonces[chainId] || 0;
        for (const tx of multisigTxs.results) {
            const note = JSON.parse(tx.origin || '{}').note || 'No note provided';
            latestNonce = parseFloat(tx.nonce) > latestNonce ? parseFloat(tx.nonce) : latestNonce;
            newTransactions.push({
                chainId: chainId,
                txHash: tx.transactionHash!,
                note: note,
            });
        }
        // update latest nonce for chain
        latestNonces[chainId] = latestNonce;
    }

    console.log('Found new transactions:', newTransactions.length);

    // send notifications for new transactions
    for (const tx of newTransactions) {
        const message = `New Treasury Transaction detected on ${chainIdToName[parseFloat(tx.chainId)]}\nNote: ${
            tx.note
        }\nTransaction Link: <${blockexplorerUrls[parseFloat(tx.chainId)]}${tx.txHash}>`;
        console.log('Sending treasury notification:', message);
        await sendMessage(ChannelId.ONCHAIN_TXNS, message);
    }

    fs.writeFileSync('./src/crons/latestNonceTreasury.json', JSON.stringify(latestNonces, null, 2));
}
