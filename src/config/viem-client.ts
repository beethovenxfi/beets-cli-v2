import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const sonic = {
    id: 146,
    name: 'Sonic',
    nativeCurrency: {
        decimals: 18,
        name: 'Sonic',
        symbol: 'S',
    },
    rpcUrls: {
        default: {
            http: ['https://rpc.soniclabs.com'],
        },
        public: {
            http: ['https://rpc.soniclabs.com'],
        },
    },
    blockExplorers: {
        default: { name: 'SonicScan', url: 'https://sonicscan.org' },
    },
} as const satisfies Chain;

// Public client for read operations
export const publicClient = createPublicClient({
    chain: sonic,
    transport: http(),
});

// Wallet client factory for different private keys
export function createWalletClientFromPrivateKey(privateKey: string) {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    return createWalletClient({
        account,
        chain: sonic,
        transport: http(),
    });
}

// Get wallet address from private key
export function getAddressFromPrivateKey(privateKey: string): string {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    return account.address;
}
