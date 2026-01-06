type CliNetworkConfigContent = {
    contractAddresses: {
        MasterChef: string;
        MasterChefOperator: string;
        MasterChefRewarderFactory: string;
        Timelock: string;
        BeethovenxToken: string;
        BeetsLp: string;
        TeamVesting: string;
        ProtocolFeesCollector: string;
        PoolSpecificProtocolFeePercentagesProvider: string;
        Reliquary: string;
        ReliquaryBeetsStreamer: string;
        multicall: string;
        Authorizer: string;
        Vault: string;
    };
    walletAddresses: {
        treasury: string;
        partnership: string;
        team: string;
        relicUpdater: string;
    };
};

type NetworkConfig = Record<number, CliNetworkConfigContent>;

export const scriptConfig: NetworkConfig = {
    146: {
        contractAddresses: {
            MasterChef: '0x8166994d9ebBe5829EC86Bd81258149B87faCfd3',
            MasterChefOperator: '0x24Dce9214bA5B93B4ee7F1A7A00c9BeB1c8F709C',
            MasterChefRewarderFactory: '0xF3906b1c590fDE35675f53Be529eF5C6639AD5dc',
            Timelock: '0xb5caee3cd5d86c138f879b3abc5b1bebb63c6471',
            BeethovenxToken: '0xF24Bcf4d1e507740041C9cFd2DddB29585aDCe1e',
            BeetsLp: '0x03c6B3f09D2504606936b1A4DeCeFaD204687890',
            TeamVesting: '0xa2503804ec837D1E4699932D58a3bdB767DeA505',
            ProtocolFeesCollector: '0xC6920d3a369E7c8BD1A22DbE385e11d1F7aF948F',
            PoolSpecificProtocolFeePercentagesProvider: '0xe101551C4772F771FEDEBecc786931E61000657C',
            Reliquary: '0x973670ce19594f857a7cd85ee834c7a74a941684',
            ReliquaryBeetsStreamer: '0xC8e3f0fC248F3A734d69045cf5174EC02173b5d0',
            multicall: '0x66335d7ad8011f6aa3f48aadcb523b62b38ed961',
            Authorizer: '0x974D3FF709D84Ba44cde3257C0B5B0b14C081Ce9',
            Vault: '0x20dd72Ed959b6147912C2e529F0a0C651c33c9ce',
        },
        walletAddresses: {
            treasury: '0xa1e849b1d6c2fd31c63eef7822e9e0632411ada7',
            partnership: '0x69739a7618469EED0685330d164D50Ac19A9411a',
            team: '0x0EDfcc1b8D082Cd46d13Db694b849D7d8151C6D5',
            relicUpdater: '0xFaC37371dFAFbfA0937DF84532D1EDED08b21718',
        },
    },
};

// Use Sonic (chain ID 146) as default network
export const networkConfig = scriptConfig[146];
export const MODERATOR_ROLE = '886027958257594379';
