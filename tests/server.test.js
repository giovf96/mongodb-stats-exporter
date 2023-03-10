const { MongoClient } = require('mongodb')
const tap = require('tap')
const { GenericContainer } = require('testcontainers')
const server = require('./../server')
const mocks = require('./mocks')
const parsePrometheusTextFormat = require('parse-prometheus-text-format')

tap.test('server', async test => {
    const mongoContainer = await new GenericContainer('mongo:4.4')
        .withExposedPorts(27017)
        .start()

    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}`

    const mongoClient = new MongoClient(mongoUri)
    await mongoClient.connect()

    const dbName = `db-stats-exporter-${Date.now()}`
    const mongoDbClient = mongoClient.db(dbName)

    for (const mock of mocks) {
        await mongoDbClient.collection(mock.name).insertMany(Array.from({ length: mock.length }, () => mock.generator()))
    }

    const fastify = await server(mongoUri, [dbName, 'wrong-db'])

    test.teardown(async () => {
        await fastify.close()
        await mongoContainer.stop()
        await mongoClient.close()
    })

    test.test('/-/metrics', async t => {
        t.test('ok', async assert => {

            const actualStats = await mongoDbClient.stats()
            const { payload, statusCode } = await fastify.inject({
                method: 'GET',
                path: '/-/metrics'
            })

            assert.strictSame(statusCode, 200)

            const parsedPrometheusMetrics = parsePrometheusTextFormat(payload)


            for (const key of Object.keys(actualStats)) {
                const objectsMetric = parsedPrometheusMetrics.find(metric => metric.name === key)
                if (objectsMetric) {
                    const objectsMetricDbValue = objectsMetric.metrics.find(metric => metric.labels.database === dbName)
                    if (typeof actualStats[key] === 'number') {
                        assert.strictSame(actualStats[key], Number(objectsMetricDbValue.value))
                    }
                }

            }

        })
    })

})