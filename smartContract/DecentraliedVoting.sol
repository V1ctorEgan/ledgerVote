// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DecentralizedVoting
 * @notice Gas-optimized voting contract - metadata stored off-chain, only critical data on-chain
 * @dev Backend indexes events for tallying and metadata
 */
contract DecentralizedVoting {
    address public admin;
    uint256 private electionCounter;
    
    // Minimal on-chain storage
    struct Election {
        uint256 startTime;
        uint256 endTime;
        bool finalized;
        bool exists;
    }
    
    // Mappings
    mapping(address => bool) public isRegistered;
    mapping(uint256 => Election) public elections;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint256 => bool)) public validCandidate;
    mapping(uint256 => uint256) public candidateCount;
    
    // Events (backend will index these)
    event ElectionCreated(
        uint256 indexed electionId,
        uint256 startTime,
        uint256 endTime,
        string title,
        string description
    );
    
    event CandidateAdded(
        uint256 indexed electionId,
        uint256 indexed candidateId,
        string name
    );
    
    event VoteCast(
        uint256 indexed electionId,
        address indexed voter,
        uint256 indexed candidateId,
        uint256 timestamp
    );
    
    event VoterRegistered(
        address indexed voter,
        uint256 timestamp
    );
    
    event ElectionFinalized(
        uint256 indexed electionId,
        uint256 timestamp
    );
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }
    
    modifier electionExists(uint256 _electionId) {
        require(elections[_electionId].exists, "Election does not exist");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        electionCounter = 0;
    }
    
    /**
     * @notice Register a new voter
     * @param _voter Address to register
     */
    function registerVoter(address _voter) external onlyAdmin {
        require(!isRegistered[_voter], "Voter already registered");
        require(_voter != address(0), "Invalid address");
        
        isRegistered[_voter] = true;
        
        emit VoterRegistered(_voter, block.timestamp);
    }
    
    /**
     * @notice Create a new election (metadata stored off-chain)
     * @param _title Election title (emitted in event for backend)
     * @param _description Election description (emitted in event for backend)
     * @param _durationMinutes How long election runs
     * @param _startDelayMinutes Delay before election starts
     * @return electionId The ID of the created election
     */
    function createElection(
        string calldata _title,
        string calldata _description,
        uint256 _durationMinutes,
        uint256 _startDelayMinutes
    ) external onlyAdmin returns (uint256) {
        require(_durationMinutes > 0, "Duration must be positive");
        
        electionCounter++;
        uint256 electionId = electionCounter;
        
        uint256 startTime = block.timestamp + (_startDelayMinutes * 1 minutes);
        uint256 endTime = startTime + (_durationMinutes * 1 minutes);
        
        elections[electionId] = Election({
            startTime: startTime,
            endTime: endTime,
            finalized: false,
            exists: true
        });
        
        emit ElectionCreated(
            electionId,
            startTime,
            endTime,
            _title,
            _description
        );
        
        return electionId;
    }
    
    /**
     * @notice Add candidate to election (metadata in event)
     * @param _electionId Election ID
     * @param _name Candidate name
     */
    function addCandidate(
        uint256 _electionId,
        string calldata _name
    ) external onlyAdmin electionExists(_electionId) {
        Election memory election = elections[_electionId];
        require(block.timestamp < election.startTime, "Election already started");
        require(!election.finalized, "Election already finalized");
        
        candidateCount[_electionId]++;
        uint256 candidateId = candidateCount[_electionId];
        
        validCandidate[_electionId][candidateId] = true;
        
        emit CandidateAdded(_electionId, candidateId, _name);
    }
    
    /**
     * @notice Cast a vote
     * @param _electionId Election ID
     * @param _candidateId Candidate ID to vote for
     */
    function vote(
        uint256 _electionId,
        uint256 _candidateId
    ) external electionExists(_electionId) {
        require(isRegistered[msg.sender], "You are not a registered voter");
        
        Election memory election = elections[_electionId];
        require(block.timestamp >= election.startTime, "Election not started");
        require(block.timestamp <= election.endTime, "Election ended");
        require(!election.finalized, "Election already finalized");
        require(!hasVoted[_electionId][msg.sender], "You have already voted in this election");
        require(validCandidate[_electionId][_candidateId], "Invalid candidate");
        
        hasVoted[_electionId][msg.sender] = true;
        
        emit VoteCast(_electionId, msg.sender, _candidateId, block.timestamp);
    }
    
    /**
     * @notice Finalize election (after end time)
     * @param _electionId Election ID
     */
    function finalizeElection(uint256 _electionId) 
        external 
        onlyAdmin 
        electionExists(_electionId) 
    {
        Election storage election = elections[_electionId];
        require(block.timestamp > election.endTime, "Election is still ongoing");
        require(!election.finalized, "Election already finalized");
        
        election.finalized = true;
        
        emit ElectionFinalized(_electionId, block.timestamp);
    }
    
    /**
     * @notice Get election status
     * @param _electionId Election ID
     * @return status String representation of status
     */
    function getElectionStatus(uint256 _electionId) 
        external 
        view 
        electionExists(_electionId) 
        returns (string memory) 
    {
        Election memory election = elections[_electionId];
        
        if (election.finalized) {
            return "Finalized";
        } else if (block.timestamp < election.startTime) {
            return "Pending";
        } else if (block.timestamp <= election.endTime) {
            return "Active";
        } else {
            return "Ended";
        }
    }
    
    /**
     * @notice Check if voter has voted in election
     * @param _electionId Election ID
     * @param _voter Voter address
     * @return bool True if voted
     */
    function hasVoterVoted(uint256 _electionId, address _voter) 
        external 
        view 
        returns (bool) 
    {
        return hasVoted[_electionId][_voter];
    }
    
    /**
     * @notice Get candidate count for election
     * @param _electionId Election ID
     * @return count Number of candidates
     */
    function getCandidateCount(uint256 _electionId) 
        external 
        view 
        returns (uint256) 
    {
        return candidateCount[_electionId];
    }
    
    /**
     * @notice Transfer admin role
     * @param _newAdmin New admin address
     */
    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Invalid address");
        admin = _newAdmin;
    }
    
    /**
     * @notice Get current election counter
     * @return uint256 Total elections created
     */
    function getTotalElections() external view returns (uint256) {
        return electionCounter;
    }
}