import { formatUnits, parseUnits } from 'viem';
import { ChannelId, sendMessage } from '../interactions/send-message';
import { publicClient, createWalletClientFromPrivateKey } from '../config/viem-client';

const pools: { [poolName: string]: { referencePool: string; beetsPool: string; minFee?: number } } = {
    'scusd/usdc-reclamm': {
        referencePool: '0x2c13383855377faf5a562f1aef47e4be7a0f12ac',
        beetsPool: '0x02e84edccf97e54bfb505b478da1d931dda13d78',
    },
    'scusd/usdc': {
        referencePool: '0x2c13383855377faf5a562f1aef47e4be7a0f12ac',
        beetsPool: '0x8d2a7e007053772340e1a8cd827512a71de94038',
    },
    'sts/ws-reclamm': {
        referencePool: '0xde861c8fc9ab78fe00490c5a38813d26e2d09c95',
        beetsPool: '0x5c9cf0f763bbde1126c5c2b06132d519fc0d2052',
    },
    'sts/ws': {
        referencePool: '0xde861c8fc9ab78fe00490c5a38813d26e2d09c95',
        beetsPool: '0x75b000584a7d86fb3ef5e15ba26f4c52b41be0e9',
    },
    'weth/usdc-reclamm': {
        referencePool: '0x6fb30f3fcb864d49cdff15061ed5c6adfee40b40',
        beetsPool: '0x4aff385131de823ec412db504d88eef646707de9',
        minFee: 0.0025,
    },
    'ws/usdc-reclamm': {
        referencePool: '0x324963c267c354c7660ce8ca3f5f167e05649970',
        beetsPool: '0xa4c937817f99829ac4003a3475f17a2f0d6eaf7c',
        minFee: 0.0025,
    },
    // 'scbtc/weth-reclamm': {
    //     referencePool: '0x6b19c48449ce9de4254a883749257be5da660bfb',
    //     beetsPool: '0xc16036a6b9395303601bd41aa8f46f560adfdfe7',
    // },
};

const SWAP_FEE_HELPER_ADDRESS = '0x9dCC172B1E4Ec399d2b929ef49f0A09483687c67';

const fee_abi = [
    {
        inputs: [],
        name: 'fee',
        outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getStaticSwapFeePercentage',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: 'pool', type: 'address' },
            { internalType: 'uint256', name: 'swapFeePercentage', type: 'uint256' },
        ],
        name: 'setStaticSwapFeePercentage',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

export async function scheduleDynamicFeeUpdater() {
    console.log('Schedule dynamic fee updater');
    await updateDynamicFees();
    // every 5min
    setInterval(updateDynamicFees, 5 * 60 * 1000);
}

export async function updateDynamicFees() {
    console.log('Checking and updating dynamic fee');
    try {
        // for each pool in the mapping, fetch the fees via onchain call
        for (const [poolName, { referencePool, beetsPool, minFee }] of Object.entries(pools)) {
            try {
                const fee = await publicClient.readContract({
                    address: beetsPool as `0x${string}`,
                    abi: fee_abi,
                    functionName: 'getStaticSwapFeePercentage',
                });

                const currentBeetsFeePercentage = Number(formatUnits(BigInt(fee as any), 18));

                const referenceFee = await publicClient.readContract({
                    address: referencePool as `0x${string}`,
                    abi: fee_abi,
                    functionName: 'fee',
                });

                const referenceFeePercentage = Number(formatUnits(BigInt(referenceFee as any), 6));

                // define fee difference boundaries between 10 and 20 percent, considering minFee if defined
                const maxBeetsFeePercentage = Math.max(
                    Math.round(referenceFeePercentage * 0.9 * 1e8) / 1e8,
                    minFee || 0,
                );
                const minBeetsFeePercentage = Math.max(
                    Math.round(referenceFeePercentage * 0.8 * 1e8) / 1e8,
                    minFee || 0,
                );

                // if the current fee percentage is outside the boundaries, update it to new percentage
                if (
                    currentBeetsFeePercentage > maxBeetsFeePercentage ||
                    currentBeetsFeePercentage < minBeetsFeePercentage
                ) {
                    // new fee is 15% less than the reference fee but at least the minFee round to 8 decimal places
                    const newBeetsFeePercentage = Math.max(
                        Math.round(referenceFeePercentage * 0.85 * 1e8) / 1e8,
                        minFee || 0,
                    );

                    console.log(
                        `Pool ${poolName} (${beetsPool}) fee calculation out of bounds, setting from ${
                            currentBeetsFeePercentage * 100
                        }% to ${newBeetsFeePercentage * 100}% (ref: ${referenceFeePercentage * 100}%)`,
                    );
                    await updateSwapFee(beetsPool, newBeetsFeePercentage);
                    await sendMessage(
                        ChannelId.SERVER_STATUS,
                        `✅ Updated swap fee for pool ${poolName} (${beetsPool}): ${(
                            currentBeetsFeePercentage * 100
                        ).toFixed(6)}% -> ${(newBeetsFeePercentage * 100).toFixed(6)}% (ref: ${(
                            referenceFeePercentage * 100
                        ).toFixed(6)}%)`,
                    );
                } else {
                    console.log(
                        `Pool ${poolName} (${beetsPool}) fee within bounds, no update needed. Current: ${
                            currentBeetsFeePercentage * 100
                        }%, Ref: ${referenceFeePercentage * 100}%, Bounds: [${minBeetsFeePercentage * 100}%, ${
                            maxBeetsFeePercentage * 100
                        }%]`,
                    );
                }
            } catch (error) {
                console.error(`Error fetching fee for pool ${beetsPool}:`, error);
            }
        }
    } catch (error) {
        console.error('Error updating dynamic fees:', error);
        await sendMessage(ChannelId.SERVER_STATUS, `❌ Error updating dynamic fees: ${error}`);
    }
}

async function updateSwapFee(poolAddress: string, newFeePercentage: number) {
    if (!process.env.FEE_UPDATER) {
        console.log('No FEE_UPDATER private key configured');
        return false;
    }

    const walletClient = createWalletClientFromPrivateKey(process.env.FEE_UPDATER);

    const newFeeScaled = parseUnits(newFeePercentage.toString(), 18);

    const { request } = await publicClient.simulateContract({
        address: SWAP_FEE_HELPER_ADDRESS as `0x${string}`,
        abi: fee_abi,
        functionName: 'setStaticSwapFeePercentage',
        args: [poolAddress as `0x${string}`, newFeeScaled],
        account: walletClient.account,
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Successfully updated pool ${poolAddress} fee to ${newFeePercentage}%. Tx hash: ${hash}`);
}
