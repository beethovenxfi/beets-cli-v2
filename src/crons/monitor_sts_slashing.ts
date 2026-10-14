import { formatEther, parseAbi } from 'viem';
import { inlineCode } from '@discordjs/builders';
import { ChannelId, sendMessage } from '../interactions/send-message';
import { publicClient, createWalletClientFromPrivateKey } from '../config/viem-client';
import sonicStakingAbiJson from '../../abi/SonicStaking.json';

const sonicStakingAbi = sonicStakingAbiJson as any;
const sonicStakingContract = '0xe5da20f15420ad15de0fa650600afc998bbe3955' as const;

const sfcAbi = parseAbi([
    'function lastValidatorID() view returns (uint256)',
    'function getStake(address delegator, uint256 validatorID) view returns (uint256)',
    'function isSlashed(uint256 validatorID) view returns (bool)',
    'function getValidator(uint256 validatorID) view returns (uint256 status, uint256 receivedStake, address auth, uint256 createdEpoch, uint256 createdTime, uint256 deactivatedTime, uint256 deactivatedEpoch)',
]);

// SFC validator status bits
const WITHDRAWN_BIT = 1n;
const OFFLINE_BIT = 1n << 3n;

const CHECK_INTERVAL_MS = 10 * 1000;
// Don't retry a failing pause tx (or re-alert) more often than this
const PAUSE_RETRY_INTERVAL_MS = 5 * 60 * 1000;

let sfcAddress: `0x${string}` | undefined;
let checkRunning = false;
let lastPauseAttempt = 0;
// Last known SFC status per validator id, to only alert on changes
const lastKnownStatus = new Map<bigint, bigint>();

export async function scheduleStsSlashingMonitor() {
    console.log(`Schedule stS slashing monitor (every ${CHECK_INTERVAL_MS / 1000}s)`);
    await runStsSlashingCheck();
    setInterval(runStsSlashingCheck, CHECK_INTERVAL_MS);
}

// Guard against overlapping runs if the RPC is slower than the interval
async function runStsSlashingCheck() {
    if (checkRunning) {
        console.log('stS slashing check: previous run still in progress, skipping tick');
        return;
    }
    checkRunning = true;
    const started = Date.now();
    try {
        await checkStsSlashing();
        console.log(`stS slashing check done in ${Date.now() - started}ms`);
    } catch (e) {
        console.log(`stS slashing check failed: ${e}`);
    } finally {
        checkRunning = false;
    }
}

export async function checkStsSlashing() {
    // Nothing to do if the contract is already fully paused
    if (await isSonicStakingPaused()) {
        console.log('stS slashing check: contract already paused, skipping');
        return;
    }

    const sfc = await getSfcAddress();

    // Discover validators stS is delegated to: every validator id with a non-zero stake from the stS contract
    const lastValidatorId = await publicClient.readContract({
        address: sfc,
        abi: sfcAbi,
        functionName: 'lastValidatorID',
    });
    const allValidatorIds = Array.from({ length: Number(lastValidatorId) }, (_, i) => BigInt(i + 1));

    const stakes = await publicClient.multicall({
        contracts: allValidatorIds.map((id) => ({
            address: sfc,
            abi: sfcAbi,
            functionName: 'getStake',
            args: [sonicStakingContract, id],
        })),
        allowFailure: false,
    });

    const delegated = allValidatorIds
        .map((id, i) => ({ id, stake: stakes[i] }))
        .filter((v) => v.stake > 0n);

    if (delegated.length === 0) {
        console.log(`stS slashing check: no delegated validators found (lastValidatorID ${lastValidatorId})`);
        return;
    }
    console.log(
        `stS slashing check: delegated to ${delegated.length}/${lastValidatorId} validators: ${delegated
            .map((v) => `${v.id} (${Number(formatEther(v.stake)).toFixed(0)} S)`)
            .join(', ')}`,
    );

    const slashedFlags = await publicClient.multicall({
        contracts: delegated.map((v) => ({
            address: sfc,
            abi: sfcAbi,
            functionName: 'isSlashed',
            args: [v.id],
        })),
        allowFailure: false,
    });

    const slashed = delegated.filter((_, i) => slashedFlags[i]);
    if (slashed.length === 0) {
        console.log('stS slashing check: no slashed validators');
        await notifyValidatorStatusChanges(sfc, delegated);
        return;
    }

    const summary = slashed
        .map((v) => `validator ${v.id} (${Number(formatEther(v.stake)).toFixed(0)} S delegated)`)
        .join(', ');
    console.log(`SLASHED stS validator(s) detected: ${summary}`);

    await pauseSonicStaking(summary);
}

// Offline or deactivated (withdrawn) validators don't warrant a pause, just a heads-up. Alert once per status change.
async function notifyValidatorStatusChanges(sfc: `0x${string}`, delegated: { id: bigint; stake: bigint }[]) {
    const validators = await publicClient.multicall({
        contracts: delegated.map((v) => ({
            address: sfc,
            abi: sfcAbi,
            functionName: 'getValidator',
            args: [v.id],
        }) as const),
        allowFailure: false,
    });

    for (const [i, v] of delegated.entries()) {
        const status = validators[i][0];
        const previous = lastKnownStatus.get(v.id);
        if (previous === status) continue;
        console.log(`stS validator ${v.id} status changed: ${previous ?? 'unknown'} -> ${status}`);

        const flags: string[] = [];
        if (status & OFFLINE_BIT) flags.push('offline');
        if (status & WITHDRAWN_BIT) flags.push('deactivated');

        const stake = `${Number(formatEther(v.stake)).toFixed(0)} S delegated`;
        try {
            if (flags.length > 0) {
                await sendMessage(
                    ChannelId.SERVER_STATUS,
                    `⚠️ stS validator ${v.id} is ${flags.join(' and ')} (SFC status ${status}, ${stake}).`,
                );
            } else if (previous !== undefined) {
                await sendMessage(ChannelId.SERVER_STATUS, `✅ stS validator ${v.id} is back to OK (${stake}).`);
            }
            // Only remember the status once the alert went out, so a failed send is retried next tick
            lastKnownStatus.set(v.id, status);
        } catch (e) {
            console.log(`Failed to send status alert for validator ${v.id}, will retry next tick: ${e}`);
        }
    }
}

async function isSonicStakingPaused(): Promise<boolean> {
    const flags = (await publicClient.multicall({
        contracts: ['depositPaused', 'undelegatePaused', 'undelegateFromPoolPaused', 'withdrawPaused'].map(
            (functionName) => ({ address: sonicStakingContract, abi: sonicStakingAbi, functionName }),
        ),
        allowFailure: false,
    })) as boolean[];
    const paused = flags.every((paused) => paused);
    console.log(
        `stS pause flags: deposit=${flags[0]} undelegate=${flags[1]} undelegateFromPool=${flags[2]} withdraw=${flags[3]} -> fully paused: ${paused}`,
    );
    return paused;
}

async function pauseSonicStaking(summary: string) {
    const now = Date.now();
    if (now - lastPauseAttempt < PAUSE_RETRY_INTERVAL_MS) {
        const sinceLast = Math.round((now - lastPauseAttempt) / 1000);
        console.log(`Pause attempted ${sinceLast}s ago, retrying in ${PAUSE_RETRY_INTERVAL_MS / 1000 - sinceLast}s`);
        return;
    }
    lastPauseAttempt = now;

    await sendMessage(
        ChannelId.SERVER_STATUS,
        `🚨 Slashed stS validator(s) detected: ${summary}. Attempting to pause the stS contract ${inlineCode(
            sonicStakingContract,
        )}.`,
    );

    if (!process.env.STS_PAUSER) {
        console.log('No STS_PAUSER private key configured');
        await sendMessage(ChannelId.SERVER_STATUS, 'Cannot pause stS: no STS_PAUSER private key configured!');
        return;
    }

    try {
        const walletClient = createWalletClientFromPrivateKey(process.env.STS_PAUSER);
        console.log(`Simulating pause() from ${walletClient.account.address}`);

        const { request } = await publicClient.simulateContract({
            address: sonicStakingContract,
            abi: sonicStakingAbi,
            functionName: 'pause',
            args: [],
            account: walletClient.account,
        });

        const hash = await walletClient.writeContract(request);
        console.log(`pause() tx sent: ${hash}, waiting for receipt`);
        await publicClient.waitForTransactionReceipt({ hash });

        console.log(`Successfully paused stS. Tx hash: ${hash}`);
        await sendMessage(ChannelId.SERVER_STATUS, `✅ stS contract paused. Tx hash: ${inlineCode(hash)}`);
    } catch (e) {
        console.log(`Failed to pause stS: ${e}`);
        await sendMessage(ChannelId.SERVER_STATUS, `❌ Error while pausing stS, please pause manually! ${e}`);
    }
}

async function getSfcAddress(): Promise<`0x${string}`> {
    if (!sfcAddress) {
        sfcAddress = (await publicClient.readContract({
            address: sonicStakingContract,
            abi: sonicStakingAbi,
            functionName: 'SFC',
        })) as `0x${string}`;
        console.log(`stS SFC address: ${sfcAddress}`);
    }
    return sfcAddress;
}
