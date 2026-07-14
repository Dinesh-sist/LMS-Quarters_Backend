const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign(
    { sub: 1, role: 'admin', username: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
);

fetch('http://localhost:5000/api/admin/status-of-applications', {
    headers: { 'Authorization': 'Bearer ' + token }
})
.then(res => res.json())
.then(data => {
    console.log("Total application statuses returned:", data?.items?.length);
    if(data?.items?.length > 0) {
        console.log("First item sample:", JSON.stringify(data.items[0], null, 2));
        console.log("Keys on first item:", Object.keys(data.items[0]));
        console.log("Samples of first 5 items:", JSON.stringify(data.items.slice(0, 5), null, 2));
    }
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
