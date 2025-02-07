

echo "First will run tests without JWT validation."

rm -f ../endorser-ch-test-local.sqlite3

NODE_ENV=test-local DBUSER=sa DBPASS=sasa npm run flyway migrate

# funny... this works without setting the DBUSER & DBPASS
NODE_ENV=test-local DBUSER=sa DBPASS=sasa PORT=3330 npm run test$1





echo "Now will run tests with JWT validation, which are much slower, which require internet, and which sometimes fail due to rate-limiting at Infura."
echo ""
echo "If you get this error: 'TypeError: Converting circular structure to JSON'"
echo "... it indicates a network problem."
echo ""
echo "In 3..."
sleep 1
echo "2..."
sleep 1
echo "1..."
sleep 1
echo "now."

rm -f ../endorser-ch-test.sqlite3

NODE_ENV=test DBUSER=sa DBPASS=sasa npm run flyway migrate

# funny... this works without setting the DBUSER & DBPASS
NODE_ENV=test DBUSER=sa DBPASS=sasa PORT=3330 npm run test$1

echo "Also be sure to check that the API docs still work: http://localhost:3000/api-explorer/"
