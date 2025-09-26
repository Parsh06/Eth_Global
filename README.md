# EventChain: Decentralized Event Gaming Platform

A decentralized event gaming platform that combines the power of Hedera and Filecoin networks to create immersive, blockchain-backed gaming experiences at real-world events.

## 🎯 Project Overview

EventChain enables users to participate in location-based gaming challenges at events through a React Native mobile application. Users check into real-world events, view a 2D map of event stalls plotted by coordinates, and join blockchain-backed challenges by staking tokens. The platform leverages cutting-edge decentralized technologies to ensure transparency, immutability, and fair play.

## 🏗️ Architecture

### Core Components

- **React Native Frontend**: Mobile app for wallet connection and 2D event visualization
- **Backend Orchestrator**: AI-enabled challenge verification and automated payout system
- **Hedera Smart Contracts**: EVM-compatible contracts for staking escrow and challenge logic
- **Filecoin Storage**: Decentralized storage for event data, challenge proofs, and metadata
- **The Graph Indexing**: Real-time querying of on-chain events and data

## 🔧 Technology Stack

### Blockchain & Web3
- **Hedera Hashgraph**: EVM-compatible smart contracts and Hedera Token Service (HTS)
- **Filecoin**: Decentralized storage via Synapse SDK or Lighthouse
- **The Graph**: On-chain event indexing and real-time data queries
- **WalletConnect**: Secure wallet authentication and connection

### Development
- **React Native**: Cross-platform mobile application
- **Node.js/Express**: Backend API orchestrator
- **AI Integration**: Challenge verification and winner determination
- **Smart Contracts**: Solidity contracts deployed on Hedera EVM

## 🎮 How It Works

### User Journey
1. **Event Check-in**: Users discover and check into real-world events
2. **Map Exploration**: Interactive 2D map displays event stalls by latitude/longitude
3. **Challenge Discovery**: Browse blockchain-backed challenges at different stalls
4. **Token Staking**: Stake tokens to participate in challenges via Hedera contracts
5. **Challenge Participation**: Submit proofs and data stored on Filecoin
6. **AI Verification**: Backend AI verifies submissions and determines winners
7. **Automated Payouts**: Smart contracts automatically distribute rewards

### Technical Flow
```
User App → WalletConnect → Hedera Smart Contracts → Token Staking
     ↓                                                      ↓
Challenge Data → Filecoin Storage → The Graph Indexing → Real-time Queries
     ↓                                                      ↓
AI Verification ← Backend Orchestrator ← Event Data ← Decentralized Storage
     ↓
Automated Payouts → Hedera Token Service → User Wallets
```

## 🚀 Features

### Decentralized Gaming
- Location-based challenges at real-world events
- Blockchain-verified staking and rewards
- Immutable challenge proofs on Filecoin
- AI-powered fair play verification

### Event Management
- 2D interactive maps with stall coordinates
- Real-time event data synchronization
- Decentralized event metadata storage
- Cross-platform mobile accessibility

### Blockchain Integration
- Hedera EVM smart contracts for escrow
- Hedera Token Service for payments
- Filecoin decentralized storage
- The Graph for real-time data indexing

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+
- React Native development environment
- Hedera testnet account
- Filecoin storage setup (Lighthouse/Synapse)
- The Graph account for indexing

### Installation

1. Clone the repository
```bash
git clone https://github.com/your-username/eventchain.git
cd eventchain
```

2. Install dependencies
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

3. Environment Configuration
```bash
# Copy environment templates
cp .env.example .env

# Configure your variables
HEDERA_ACCOUNT_ID=your_account_id
HEDERA_PRIVATE_KEY=your_private_key
FILECOIN_API_KEY=your_filecoin_key
GRAPH_API_KEY=your_graph_key
```

4. Deploy Smart Contracts
```bash
cd contracts
npm install
npx hardhat deploy --network hedera-testnet
```

5. Start Development Servers
```bash
# Backend
cd backend
npm run dev

# Frontend
cd frontend
npx react-native start
npx react-native run-android # or run-ios
```

## 📁 Project Structure

```
eventchain/
├── backend/                 # Backend orchestrator and API
│   ├── src/
│   │   ├── controllers/     # API controllers
│   │   ├── services/        # Business logic
│   │   ├── ai/             # AI verification modules
│   │   └── web3/           # Blockchain integrations
│   └── package.json
├── frontend/               # React Native mobile app
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── screens/        # App screens
│   │   ├── services/       # API and web3 services
│   │   └── utils/          # Helper utilities
│   └── package.json
├── contracts/              # Hedera smart contracts
│   ├── contracts/          # Solidity contracts
│   ├── scripts/            # Deployment scripts
│   └── hardhat.config.js
├── subgraph/              # The Graph indexing
│   ├── schema.graphql      # GraphQL schema
│   ├── subgraph.yaml       # Subgraph manifest
│   └── src/                # Mapping functions
└── docs/                  # Documentation
```

## 🔐 Smart Contracts

### Core Contracts
- **EventGameHub.sol**: Main contract managing events and challenges
- **StakingEscrow.sol**: Token staking and escrow management
- **ChallengeVerifier.sol**: Challenge validation and payout logic
- **HTSIntegration.sol**: Hedera Token Service integration

### Deployment
Contracts are deployed on Hedera testnet and mainnet. View verified contracts on [HashScan](https://hashscan.io/).

## 📊 Data Storage & Indexing

### Filecoin Integration
- Event metadata and configuration
- Challenge submission proofs
- Game replay data
- User-generated content

### The Graph Indexing
- Real-time staking events
- Challenge completions
- Payout transactions
- User activity metrics

## 🤖 AI Integration

The platform incorporates AI for:
- Challenge submission verification
- Fair play detection
- Winner determination algorithms
- Fraud prevention mechanisms

## 🏆 ETHGlobal Hackathon Compliance

### Hedera Track Requirements
- ✅ EVM-compatible smart contracts deployed
- ✅ Hedera Token Service integration
- ✅ Verified contracts on HashScan
- ✅ Real-world use case demonstration

### Filecoin Track Requirements
- ✅ Decentralized storage implementation
- ✅ Synapse SDK or Lighthouse integration
- ✅ Immutable data storage
- ✅ Censorship-resistant architecture

## 🎥 Demo & Documentation

- **Live Demo**: [Demo Link]
- **Video Walkthrough**: [YouTube Link]
- **Contract Verification**: [HashScan Links]
- **API Documentation**: [Docs Link]

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Website**: [EventChain.app]
- **Documentation**: [docs.eventchain.app]
- **Discord**: [Community Discord]
- **Twitter**: [@EventChainApp]

## 🙏 Acknowledgments

- ETHGlobal for hosting the hackathon
- Hedera team for EVM compatibility and HTS
- Filecoin team for decentralized storage solutions
- The Graph team for indexing infrastructure

---

Built with ❤️ for ETHGlobal Hackathon | Powered by Hedera & Filecoin