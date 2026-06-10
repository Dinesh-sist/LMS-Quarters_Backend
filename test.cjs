const bcrypt = require('bcrypt');

bcrypt.hash('lms123', 10).then(hash => {
    console.log(hash);
});