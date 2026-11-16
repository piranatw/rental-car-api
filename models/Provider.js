const mongoose = require('mongoose');

const ProviderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please add a name']
    },
    address: {
        type: String,
        required: [true, 'Please add an address']
    },
    district: {
        type: String,
        required: [true, 'Please add a district']
    },
    province: {
        type: String,
        required: [true, 'Please add a province']
    },
    postalcode: {
        type: String,
        required: [true, 'Please add a postal code'],
        maxlength: 5
    },
    tel: String,
    region: String
}, {
    toJSON: {virtuals:true},
    toObject:{virtuals:true}
});

//Reverse populate with virtuals
ProviderSchema.virtual('bookings',{
    ref: 'Booking',
    localField: '_id',
    foreignField:'provider',
    justOne:false
});

module.exports = mongoose.model('Provider', ProviderSchema);
