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
        console.log("First item sample:", {
            empName: data.items[0].empName,
            publishedDateFrom: data.items[0].publishedDateFrom,
            publishedDateTo: data.items[0].publishedDateTo,
            result: data.items[0].result
        });
    }
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
