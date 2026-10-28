import { formatEther, parseAbi, parseAbiItem } from 'viem';
import { inlineCode } from '@discordjs/builders';
import { ChannelId, sendMessage } from '../interactions/send-message';
import { publicClient } from '../config/viem-client';
import sonicStakingAbiJson from '../../abi/SonicStaking.json';

const sonicStakingAbi = sonicStakingAbiJson as any;
const sonicStakingContract = '0xe5da20f15420ad15de0fa650600afc998bbe3955' as const;
// Operator multisig that has to call operatorExecuteClawBack
const operatorSafeUrl = 'https://app.safe.global/transactions/queue?safe=sonic:0x6840Bd91417373Af296cc263e312DfEBcAb494ae';

const clawBackInitiatedEvent = parseAbiItem(
    'event OperatorClawBackInitiated(uint256 indexed withdrawId, uint256 indexed validatorId, uint256 amountAssets)',
);

const sfcAbi = parseAbi(['function isSlashed(uint256 validatorID) view returns (bool)']);

const CHECK_INTERVAL_MS = 60 * 1000;

type WithdrawRequest = {
    kind: number;
    validatorId: bigint;
    assetAmount: bigint;
    isWithdrawn: boolean;
    requestTimestamp: bigint;
    user: string;
};

type TrackedClawBack = {
    validatorId: bigint;
    reportedInitiated: boolean;
    reportedExecutable: boolean;
};

let checkRunning = false;
let sfcAddress: `0x${string}` | undefined;
// Next block to scan for OperatorClawBackInitiated events
let nextScanBlock = 0n;
// pendingClawBackAmount seen on the previous tick; a change means a clawback was initiated or executed
let lastPendingClawBackAmount: bigint | undefined;
// Clawback withdraw ids discovered on chain that are not executed yet
const trackedClawBacks = new Map<bigint, TrackedClawBack>();

export async function scheduleStsClawBackMonitor() {
    console.log('Schedule stS clawback monitor');
    await runStsClawBackCheck();
    setInterval(runStsClawBackCheck, CHECK_INTERVAL_MS);
}

async function runStsClawBackCheck() {
    if (checkRunning) return;
    checkRunning = true;
    try {
        await checkStsClawBacks();
    } catch (e) {
        console.log(`stS clawback check failed: ${e}`);
    } finally {
        checkRunning = false;
    }
}

export async function checkStsClawBacks() {
    const pendingClawBackAmount = (await publicClient.readContract({
        address: sonicStakingContract,
        abi: sonicStakingAbi,
        functionName: 'pendingClawBackAmount',
    })) as bigint;

    if (pendingClawBackAmount === 0n && trackedClawBacks.size === 0) return;

    // Only scan logs for new clawbacks when the pending amount changed (i.e. on a new initiate), not every tick
    if (pendingClawBackAmount !== lastPendingClawBackAmount) {
        await discoverNewClawBacks();
        lastPendingClawBackAmount = pendingClawBackAmount;
    }
    if (trackedClawBacks.size === 0) return;

    const withdrawIds = [...trackedClawBacks.keys()];
    const [withdrawDelay, ...requests] = (await publicClient.multicall({
        contracts: [
            { address: sonicStakingContract, abi: sonicStakingAbi, functionName: 'withdrawDelay', args: [] },
            ...withdrawIds.map((withdrawId) => ({
                address: sonicStakingContract,
                abi: sonicStakingAbi,
                functionName: 'getWithdrawRequest',
                args: [withdrawId],
            })),
        ],
        allowFailure: false,
    })) as [bigint, ...WithdrawRequest[]];

    const now = BigInt(Math.floor(Date.now() / 1000));

    for (const [i, withdrawId] of withdrawIds.entries()) {
        const request = requests[i];
        const tracked = trackedClawBacks.get(withdrawId)!;
        const amount = `${Number(formatEther(request.assetAmount)).toFixed(0)} S`;
        const executableAt = request.requestTimestamp + withdrawDelay;

        if (request.isWithdrawn) {
            trackedClawBacks.delete(withdrawId);
            // Only report executions of clawbacks we announced, not historical ones found on the first scan
            if (tracked.reportedInitiated) {
                await sendMessage(
                    ChannelId.SERVER_STATUS,
                    `✅ stS clawback ${withdrawId} from validator ${request.validatorId} (${amount}) has been executed.`,
                );
            }
            continue;
        }

        if (!tracked.reportedInitiated) {
            tracked.reportedInitiated = true;
            await sendMessage(
                ChannelId.SERVER_STATUS,
                `ℹ️ stS clawback ${withdrawId} initiated for validator ${request.validatorId} (${amount}). Executable from ${formatTimestamp(
                    executableAt,
                )}.`,
            );
        }

        if (!tracked.reportedExecutable && now >= executableAt) {
            tracked.reportedExecutable = true;
            const emergency = await isValidatorSlashed(request.validatorId);
            await sendMessage(
                ChannelId.SERVER_STATUS,
                `⏰ stS clawback ${withdrawId} from validator ${request.validatorId} (${amount}) can be executed now${
                    emergency ? ' (validator is slashed, emergency=true accepts the penalty)' : ''
                }.\nMultisig: ${operatorSafeUrl}\nContract: ${inlineCode(sonicStakingContract)}\nFunction: ${inlineCode(
                    'operatorExecuteClawBack',
                )}\nwithdrawId: ${inlineCode(String(withdrawId))}\nemergency: ${inlineCode(String(emergency))}`,
            );
        }
    }
}

// Scan OperatorClawBackInitiated events since the last scanned block and start tracking new withdraw ids
async function discoverNewClawBacks() {
    const latestBlock = await publicClient.getBlockNumber();
    if (latestBlock < nextScanBlock) return;

    const logs = await publicClient.getLogs({
        address: sonicStakingContract,
        event: clawBackInitiatedEvent,
        fromBlock: nextScanBlock,
        toBlock: latestBlock,
    });
    nextScanBlock = latestBlock + 1n;

    for (const log of logs) {
        const withdrawId = log.args.withdrawId!;
        if (!trackedClawBacks.has(withdrawId)) {
            trackedClawBacks.set(withdrawId, {
                validatorId: log.args.validatorId!,
                reportedInitiated: false,
                reportedExecutable: false,
            });
        }
    }
}

async function isValidatorSlashed(validatorId: bigint): Promise<boolean> {
    if (!sfcAddress) {
        sfcAddress = (await publicClient.readContract({
            address: sonicStakingContract,
            abi: sonicStakingAbi,
            functionName: 'SFC',
        })) as `0x${string}`;
    }
    return publicClient.readContract({ address: sfcAddress, abi: sfcAbi, functionName: 'isSlashed', args: [validatorId] });
}

function formatTimestamp(timestamp: bigint): string {
    return new Date(Number(timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
