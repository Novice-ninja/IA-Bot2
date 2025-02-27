const socket = new WebSocket(`ws://${window.location.host}/ws`);
const chatMessages = $("#chat-messages");

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    switch(data.type) {
        case "thinking":
            $(".thinking-animation").remove();
            chatMessages.append(`
                <div class="thinking-animation">
                    <div class="thinking-spinner"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                </div>
            `);
            break;
        case "question":
            chatMessages.append(`<div class="message bot-message fade-in">${data.message}</div>`);
            break;
        case "message":
            $(".thinking-animation").remove();
            chatMessages.append(`<div class="message bot-message fade-in">${data.content}</div>`);
            break;
        case "result":
            $(".thinking-animation").remove();
            renderResults(data);
            break;
        case "error":
            $(".thinking-animation").remove();
            chatMessages.append(`<div class="message bot-message text-danger fade-in">Error: ${data.message}</div>`);
            break;
    }
    chatMessages.scrollTop(chatMessages[0].scrollHeight);
};

function sendMessage() {
    const input = $("#user-input");
    const message = input.val().trim();
    if (message) {
        chatMessages.append(`<div class="message user-message fade-in">${message}</div>`);
        socket.send(message);
        chatMessages.append(`
            <div class="thinking-animation">
                <div class="thinking-spinner"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
        `);
        chatMessages.scrollTop(chatMessages[0].scrollHeight);
        input.val("");
    }
}



function renderResults(data) {
    let financialTable = '';
    let benefitsTable = '';
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

    // Benefits Table
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
        summary = data.data.summary || 'Financial benefits calculated.';
    } else {
        summary = 'No benefits calculated due to insufficient data.';
    }

    chatMessages.append(`
        <div class="message bot-message fade-in">
            ${financialTable}
            ${benefitsTable}
            <div class="summary mt-3">${summary}</div>
        </div>
    `);
}

function renderResults_low_high(data) {
    let table = '';
    let summary = '';

    // Check if benefits data is present and render as table
    if (data.data && data.data.benefits && typeof data.data.benefits === 'object') {
        table = `
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
    }

    // Set summary text
    summary = data.data && data.data.summary ? data.data.summary : 'No summary available.';

    chatMessages.append(`
        <div class="message bot-message fade-in">
            ${table}
            <div class="summary mt-3">${summary}</div>
        </div>
    `);
}

$("#user-input").keypress(function(e) {
    if (e.which == 13) {
        sendMessage();
    }
});