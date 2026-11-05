import axios from 'axios';
import SafeApiKit from '@safe-global/api-kit';
import { decodeFunctionData, formatEther, getAddress, parseAbi } from 'viem';
import { publicClient } from '../config/viem-client';
import sonicStakingAbiJson from '../../abi/SonicStaking.json';

const sonicStakingAbi = sonicStakingAbiJson as any;
const sonicStakingContract = '0xe5da20f15420ad15de0fa650600afc998bbe3955' as const;

// Same rules as the delegatooooor delegation proposer (helpers/delegation_proposer.py)
const RECOMMENDATION_URL = 'https://sts-helper.beets-ftm-node.com/api/stake-recommendation';
const CHUNK_SIZE = 500_000n * 10n ** 18n;
const MIN_DELEGATION = 10_000n * 10n ** 18n;

const sfcAbi = parseAbi([
    'function constsAddress() view returns (address)',
    'function getSelfStake(uint256 validatorID) view returns (uint256)',
    'function getValidator(uint256 validatorID) view returns (uint256 status, uint256 receivedStake, address auth, uint256 createdEpoch, uint256 createdTime, uint256 deactivatedTime, uint256 deactivatedEpoch)',
]);
const constsAbi = parseAbi(['function maxDelegatedRatio() view returns (uint256)']);

type RecommendationResponse = {
    data: {
        recommendations: { stakeMore: { validatorId: string; recommendedAmount: number }[] };
        validators: Record<string, { validatorId: string; remainingCapacity: number; canReceiveDelegation: boolean }[]>;
    };
};

export type ClawBackBatch = {
    clawedBack: bigint;
    delegations: { validatorId: bigint; amount: bigint }[];
    undelegated: bigint;
    json: string;
};

// Build a Safe Transaction Builder batch: operatorExecuteClawBack followed by delegate() calls that put the clawed back S
// to work right away, split over validators by the same rules the delegatooooor uses to fill the Safe queue.
export async function buildClawBackBatch(
    operatorSafe: `0x${string}`,
    withdrawId: bigint,
    clawBackValidatorId: bigint,
    emergency: boolean,
): Promise<ClawBackBatch> {
    // Simulate the execution from the Safe to get the exact amount that lands in the pool (accounts for slashing penalties)
    const { result: clawedBack } = (await publicClient.simulateContract({
        address: sonicStakingContract,
        abi: sonicStakingAbi,
        functionName: 'operatorExecuteClawBack',
        args: [withdrawId, emergency],
        account: operatorSafe,
    })) as { result: bigint };

    const delegations = await planDelegations(operatorSafe, clawedBack, clawBackValidatorId);
    const delegated = delegations.reduce((sum, d) => sum + d.amount, 0n);

    const transactions = [
        txBuilderCall('operatorExecuteClawBack', { withdrawId: String(withdrawId), emergency: String(emergency) }),
        ...delegations.map((d) =>
            txBuilderCall('delegate', { validatorId: String(d.validatorId), amount: String(d.amount) }),
        ),
    ];
    const batch = {
        version: '1.0',
        chainId: '146',
        createdAt: Date.now(),
        meta: {
            name: `stS clawback ${withdrawId} + delegate`,
            description: `Execute clawback ${withdrawId} from validator ${clawBackValidatorId} (${formatS(
                clawedBack,
            )}) and delegate ${formatS(delegated)} of it`,
            txBuilderVersion: '1.18.0',
            createdFromSafeAddress: operatorSafe,
        },
        transactions,
    };

    return { clawedBack, delegations, undelegated: clawedBack - delegated, json: JSON.stringify(batch, null, 2) };
}

async function planDelegations(
    operatorSafe: `0x${string}`,
    amount: bigint,
    excludedValidatorId: bigint,
): Promise<{ validatorId: bigint; amount: bigint }[]> {
    const { data } = (await axios.get<RecommendationResponse>(RECOMMENDATION_URL, { timeout: 15_000 })).data;

    const apiCapacity = new Map<string, bigint>();
    for (const group of Object.values(data.validators)) {
        for (const v of group) apiCapacity.set(v.validatorId, v.canReceiveDelegation ? toWei(v.remainingCapacity) : 0n);
    }

    // Gap per validator still to fill, and how much it can take: min(API remainingCapacity, on-chain SFC room)
    const remaining = new Map<string, bigint>();
    for (const rec of data.recommendations.stakeMore) {
        if (rec.validatorId !== String(excludedValidatorId)) remaining.set(rec.validatorId, toWei(rec.recommendedAmount));
    }
    const sfcRoom = await getSfcRoom([...remaining.keys()]);
    const room = new Map([...remaining.keys()].map((v) => [v, min(apiCapacity.get(v) ?? 0n, sfcRoom.get(v)!)]));

    // Delegations already queued in the Safe will be filled from the pool as well, so count them as done
    for (const queued of await getQueuedDelegations(operatorSafe)) {
        if (!remaining.has(queued.validatorId)) continue;
        remaining.set(queued.validatorId, remaining.get(queued.validatorId)! - queued.amount);
        room.set(queued.validatorId, room.get(queued.validatorId)! - queued.amount);
    }

    // Hand out CHUNK_SIZE chunks to the validator with the largest gap, merged into one delegate call per validator
    const plan = new Map<string, bigint>();
    let left = amount;
    while (left >= MIN_DELEGATION) {
        let best: string | undefined;
        for (const [v, gap] of remaining) {
            if (room.get(v)! >= MIN_DELEGATION && (best === undefined || gap > remaining.get(best)!)) best = v;
        }
        if (best === undefined) break;
        const chunk = min(CHUNK_SIZE, remaining.get(best)!, room.get(best)!, left);
        if (chunk < MIN_DELEGATION) break;
        plan.set(best, (plan.get(best) ?? 0n) + chunk);
        remaining.set(best, remaining.get(best)! - chunk);
        room.set(best, room.get(best)! - chunk);
        left -= chunk;
    }

    return [...plan].map(([validatorId, amount]) => ({ validatorId: BigInt(validatorId), amount }));
}

// On-chain delegation room per validator: selfStake * maxDelegatedRatio - receivedStake. Inactive validators get 0.
async function getSfcRoom(validatorIds: string[]): Promise<Map<string, bigint>> {
    const sfc = (await publicClient.readContract({
        address: sonicStakingContract,
        abi: sonicStakingAbi,
        functionName: 'SFC',
    })) as `0x${string}`;
    const consts = await publicClient.readContract({ address: sfc, abi: sfcAbi, functionName: 'constsAddress' });
    const maxRatio = await publicClient.readContract({ address: consts, abi: constsAbi, functionName: 'maxDelegatedRatio' });

    const results = await publicClient.multicall({
        contracts: validatorIds.flatMap((id) => [
            { address: sfc, abi: sfcAbi, functionName: 'getValidator', args: [BigInt(id)] } as const,
            { address: sfc, abi: sfcAbi, functionName: 'getSelfStake', args: [BigInt(id)] } as const,
        ]),
        allowFailure: false,
    });

    const room = new Map<string, bigint>();
    for (const [i, id] of validatorIds.entries()) {
        const [status, receivedStake] = results[2 * i] as readonly [bigint, bigint, ...unknown[]];
        const selfStake = results[2 * i + 1] as bigint;
        room.set(id, status === 0n ? (selfStake * maxRatio) / 10n ** 18n - receivedStake : 0n);
    }
    return room;
}

// Unexecuted delegate txs in the Safe queue (newest tx per nonce only, like the delegatooooor)
async function getQueuedDelegations(operatorSafe: `0x${string}`): Promise<{ validatorId: string; amount: bigint }[]> {
    const apiKit = new SafeApiKit({ chainId: 146n, apiKey: process.env.SAFE_API_KEY });
    const { results } = await apiKit.getPendingTransactions(operatorSafe, { limit: 100 });

    const latest = new Map<string, (typeof results)[number]>();
    for (const tx of results) {
        const current = latest.get(tx.nonce);
        if (!current || tx.submissionDate > current.submissionDate) latest.set(tx.nonce, tx);
    }

    const queued: { validatorId: string; amount: bigint }[] = [];
    for (const tx of latest.values()) {
        if (tx.to.toLowerCase() !== sonicStakingContract || !tx.data) continue;
        try {
            const { functionName, args } = decodeFunctionData({ abi: sonicStakingAbi, data: tx.data as `0x${string}` });
            if (functionName !== 'delegate') continue;
            const [validatorId, amount] = args as [bigint, bigint];
            queued.push({ validatorId: String(validatorId), amount });
        } catch {
            // not an stS call we know
        }
    }
    return queued;
}

function txBuilderCall(functionName: string, contractInputsValues: Record<string, string>) {
    const abiItem = sonicStakingAbi.find((item: any) => item.type === 'function' && item.name === functionName);
    return {
        to: getAddress(sonicStakingContract),
        value: '0',
        data: null,
        contractMethod: {
            inputs: abiItem.inputs.map(({ internalType, name, type }: any) => ({ internalType, name, type })),
            name: functionName,
            payable: false,
        },
        contractInputsValues,
    };
}

function toWei(amountS: number): bigint {
    return BigInt(Math.floor(amountS)) * 10n ** 18n;
}

function min(...values: bigint[]): bigint {
    return values.reduce((a, b) => (b < a ? b : a));
}

export function formatS(amount: bigint): string {
    return `${Number(formatEther(amount)).toLocaleString('en-US', { maximumFractionDigits: 0 })} S`;
}
