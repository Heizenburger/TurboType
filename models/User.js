const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    gamertag: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: 'https://api.dicebear.com/7.x/bottts/svg?seed=Ninja' }, 
    
    skillScore: { type: Number, default: 0 }, 
    globalMetrics: {
        avgWpm: { type: Number, default: 0 },
        avgAccuracy: { type: Number, default: 0 },
        peakBurstSpeed: { type: Number, default: 0 }
    },

    games: {
        turboRacing: { played: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
        samuraiTyping: { played: { type: Number, default: 0 }, highestWave: { type: Number, default: 0 } },
        syntaxArena: { played: { type: Number, default: 0 }, wins: { type: Number, default: 0 } },
        colosseumRaid: { played: { type: Number, default: 0 }, totalDamage: { type: Number, default: 0 } },
        // NEW NEON ROYALE TRACKING
        neonRoyale: { played: { type: Number, default: 0 }, wins: { type: Number, default: 0 } }
    }
});

module.exports = mongoose.model('User', userSchema);