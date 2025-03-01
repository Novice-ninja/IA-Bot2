// WebSocket for user input (port 8000)
const socketMain = new WebSocket(`ws://${window.location.host}/ws`);
// WebSocket for predefined questions (port 8001)
const socketPredefined = new WebSocket(`ws://${window.location.host.replace(':8000', ':8001')}/ws`);
const chatMessages = $("#chat-messages");

// Predefined questions to engage the user
const predefinedQuestions = [
    "What is the market cap of Tesla?",
    "How does Apple's revenue compare to last year?",
    "What are the latest financials for Microsoft?",
    "Can you analyze Amazon's gross profit?",
    "What is the headcount of Google?"
];

// Track if first user input has been sent and if predefined questions are added
let firstInputSent = false;
let predefinedQuestionsAdded = false; // Flag to track if questions are already added
// Store pending requests with unique IDs
const pendingRequests = new Map();

// Debug logging
console.log("Opening WebSocket connections...");
socketMain.onopen = () => console.log("Main WebSocket (port 8000) opened at", new Date().toISOString());
socketPredefined.onopen = () => console.log("Predefined WebSocket (port 8001) opened at", new Date().toISOString());

socketMain.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log(`Main WS (8000) received at ${new Date().toISOString()}:`, data, "Request ID:", data.request_id);
    
    switch(data.type) {
        case "thinking":
            // Check if this question is already in the DOM to prevent duplicates
            if (!$(`#container-${data.request_id}`).length) {
                const userMessage = pendingRequests.get(data.request_id);
                if (!userMessage) {
                    console.warn(`No message found for request_id: ${data.request_id}`);
                }
                chatMessages.append(`
                    <div class="message-container" id="container-${data.request_id}">
                        <div class="message user-message fade-in">${userMessage || "Unknown question"}</div>
                        <div class="thinking-animation" id="loader-${data.request_id}">
                            <div class="thinking-spinner"></div>
                            <div class="thinking-dot"></div>
                            <div class="thinking-dot"></div>
                            <div class="thinking-dot"></div>
                        </div>
                    </div>
                `);
            }
            // Show predefined questions only after first user input and if not already added
            if (!firstInputSent) {
                firstInputSent = true;
                if (!predefinedQuestionsAdded) {
                    chatMessages.append(`
                        <div class="predefined-questions">
                            ${predefinedQuestions.map((q, index) => `
                                <button class="btn btn-outline-secondary m-2 question-btn" onclick="sendPredefinedQuestion('${escapeSingleQuotes(q)}', '${data.request_id}')">${q}</button>
                            `).join('')}
                        </div>
                    `);
                    predefinedQuestionsAdded = true; // Mark as added to prevent duplicates
                }
            }
            chatMessages.scrollTop(chatMessages[0].scrollHeight);
            break;
        case "question":
            $(`#loader-${data.request_id}`).remove();
            $(`#container-${data.request_id}`).append(`<div class="message bot-message fade-in">${data.message}</div>`);
            break;
        case "message":
            $(`#loader-${data.request_id}`).remove();
            $(`#container-${data.request_id}`).append(`<div class="message bot-message fade-in">${data.content}</div>`);
            pendingRequests.delete(data.request_id);
            break;
        case "result":
            $(`#loader-${data.request_id}`).remove();
            renderResults(data, data.request_id);
            pendingRequests.delete(data.request_id);
            break;
        case "error":
            $(`#loader-${data.request_id}`).remove();
            $(`#container-${data.request_id}`).append(`<div class="message bot-message text-danger fade-in">Error: ${data.message}</div>`);
            pendingRequests.delete(data.request_id);
            break;
    }
};

socketPredefined.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log(`Predefined WS (8001) received at ${new Date().toISOString()}:`, data, "Request ID:", data.request_id);
    
    switch(data.type) {
        case "thinking":
            // Check if this question is already in the DOM to prevent duplicates
            if (!$(`#container-${data.request_id}`).length) {
                const userMessage = pendingRequests.get(data.request_id) || "Unknown question";
                chatMessages.append(`
                    <div class="message-container" id="container-${data.request_id}">
                        <div class="message user-message fade-in">${userMessage}</div>
                        <div class="thinking-animation" id="loader-${data.request_id}">
                            <div class="thinking-spinner"></div>
                            <div class="thinking-dot"></div>
                            <div class="thinking-dot"></div>
                            <div class="thinking-dot"></div>
                        </div>
                    </div>
                `);
            }
            break;
        case "message":
            $(`#loader-${data.request_id}`).remove();
            $(`#container-${data.request_id}`).append(`<div class="message bot-message fade-in">${data.content}</div>`);
            pendingRequests.delete(data.request_id);
            break;
        case "error":
            $(`#loader-${data.request_id}`).remove();
            $(`#container-${data.request_id}`).append(`<div class="message bot-message text-danger fade-in">Error: ${data.message}</div>`);
            pendingRequests.delete(data.request_id);
            break;
    }
};

function sendMessage() {
    const input = $("#user-input");
    const message = input.val().trim();
    if (message) {
        const requestId = Date.now().toString();
        // Check if this question is already in the DOM to prevent duplicates
        if (!$(`#container-${requestId}`).length) {
            chatMessages.append(`
                <div class="message-container" id="container-${requestId}">
                    <div class="message user-message fade-in">${message}</div>
                    <div class="thinking-animation" id="loader-${requestId}">
                        <div class="thinking-spinner"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                </div>
            `);
            socketMain.send(JSON.stringify({ type: "user_input", content: message, request_id: requestId }));
            pendingRequests.set(requestId, message);
        }
        chatMessages.scrollTop(chatMessages[0].scrollHeight);
        input.val("");
    }
}

function sendPredefinedQuestion(question, parentRequestId) {
    const requestId = Date.now().toString();
    // Escape single quotes and check for duplicates
    const escapedQuestion = escapeSingleQuotes(question);
    if (!$(`#container-${requestId}`).length) {
        chatMessages.append(`
            <div class="message-container" id="container-${requestId}">
                <div class="message user-message fade-in">${question}</div>
                <div class="thinking-animation" id="loader-${requestId}">
                    <div class="thinking-spinner"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                </div>
            </div>
        `);
    }
    socketPredefined.send(JSON.stringify({ type: "predefined_question", content: escapedQuestion, request_id: requestId, parent_request_id: parentRequestId }));
    pendingRequests.set(requestId, question);
    chatMessages.scrollTop(chatMessages[0].scrollHeight);
}

// Function to escape single quotes and other special characters for JSON safety
function escapeSingleQuotes(str) {
    return str
        .replace(/'/g, "\\'")  // Escape single quotes
        .replace(/"/g, '\\"')  // Escape double quotes
        .replace(/\n/g, '\\n') // Escape newlines
        .replace(/\r/g, '\\r'); // Escape carriage returns
}

function parseBenefitValue(value) {
    if (value === "Not Available") return 0;
    const match = value.match(/(\d+\.?\d*)\s*([BKM]?)$/i);
    if (!match) return parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    const num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    return num * (suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1);
}

const chartInstances = new Map();

function createBarChart(canvasId, labels, lowValues, highValues, currency) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    // Destroy any existing chart instance for this canvas
    if (chartInstances.has(canvasId)) {
        chartInstances.get(canvasId).destroy();
    }

    // Create new chart and store it
    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Low Estimate',
                data: lowValues,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }, {
                label: 'High Estimate',
                data: highValues,
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: `Value (${currency})`
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Benefits'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });

    chartInstances.set(canvasId, newChart);
}

function renderResults(data, requestId) {
    let financialTable = '';
    let benefitsTable = '';
    let barChart = '';
    let summary = '';

    // Financial Data Table
    if (data.data && data.data.financial_data && typeof data.data.financial_data === 'object') {
        const currency = data.data.financial_data.currency || '';
        financialTable = `
            <h4>Financial Data</h4>
            <table class="table table-dark table-striped mt-3">
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(data.data.financial_data).map(([key, value]) => {
                        const monetaryFields = ["balance_sheet_inventory_cost", "P&L_inventory_cost", "Revenue", "Salary Average", "gross_profit", "market_cap"];
                        let displayValue = value || 'N/A';
                        if (monetaryFields.includes(key) && value && value !== "Not Available") {
                            displayValue = `${value}`;
                        }
                        return `
                            <tr>
                                <td>${key.replace(/_/g, ' ')}</td>
                                <td>${displayValue}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    // Benefits Table and Bar Chart
    if (data.data && data.data.benefits && typeof data.data.benefits === 'object') {
        const currency = data.data.financial_data.currency || '';
        benefitsTable = `
            <h4>Calculated Benefits</h4>
            <table class="table table-dark table-striped mt-3">
                <thead>
                    <tr>
                        <th>Benefit</th>
                        <th>Low Estimate</th>
                        <th>High Estimate</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(data.data.benefits).map(([key, value]) => `
                        <tr>
                            <td>${key.replace(/_/g, ' ')}</td>
                            <td>${value.low || 'N/A'}</td>
                            <td>${value.high || 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        const labels = Object.keys(data.data.benefits);
        const lowValues = labels.map(key => parseBenefitValue(data.data.benefits[key].low));
        const highValues = labels.map(key => parseBenefitValue(data.data.benefits[key].high));

        const canvasId = `benefitsChart_${Date.now()}`;
        barChart = `
            <h4>Benefits Bar Graph</h4>
            <canvas id="${canvasId}" width="400" height="200" class="mt-3"></canvas>
        `;

        summary = data.data.summary || 'Financial benefits calculated.';
        $(`#container-${requestId}`).append(`
            <div class="message bot-message fade-in">
                ${financialTable}
                ${benefitsTable}
                ${barChart}
                <div class="summary mt-3">${summary}</div>
            </div>
        `);

        // Initialize the chart after appending
        createBarChart(canvasId, labels, lowValues, highValues, currency);
    } else {
        summary = data.data.summary || 'No benefits calculated due to insufficient data.';
        $(`#container-${requestId}`).append(`
            <div class="message bot-message fade-in">
                ${financialTable}
                <div class="summary mt-3">${summary}</div>
            </div>
        `);
    }
}

$("#user-input").keypress(function(e) {
    if (e.which == 13) {
        sendMessage();
    }
});