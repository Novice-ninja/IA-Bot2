# main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from crewai import Crew, Process
from agents import DataCollectorAgent, DataFormatterAgent, SummaryGeneratorAgent, BenefitCalculatorAgent
from retrieval_agent import RetrievalAgent
from tools import FinanceTools
import json
import os
import re
import time
from dotenv import load_dotenv
from config import llm_client  # Import llm_client for question detection and response generation
from crewai import Crew, Process, Agent, Task

load_dotenv()

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

finance_tools = FinanceTools()
retrieval_agent = RetrievalAgent()  # Initialize the RetrievalAgent

MAX_RETRIES = int(os.getenv("MAX_RETRIES", 3))


llm_agent = Agent(
    role="Text Analyzer and Responder",
    goal="Analyze text and generate natural language responses",
    backstory="I'm an expert at understanding and responding to user inputs.",
    verbose=True,
    llm=llm_client
)

@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

def fix_json_string(json_str):
    """Fix a JSON string by replacing single quotes with double quotes where appropriate."""
    if not json_str or not isinstance(json_str, str):
        return json_str
    json_str = re.sub(r"(?<!\\)'", '"', json_str)
    json_str = json_str.replace("\\'", "'")
    return json_str

async def send_agent_update(websocket: WebSocket, agent_name: str, tool_name: str, request_id: str):
    """Send an update about the current agent and tool being used."""
    await websocket.send_json({
        "type": "agent_update",
        "agent": agent_name,
        "tool": tool_name,
        "request_id": request_id
    })

async def detect_question(text: str) -> dict:
    task = Task(
        description=f"""
        Analyze the following text and determine:
        1. Whether it is a question (True/False). A question is any sentence or phrase that seeks information, clarification, or an answer. Do not rely solely on specific keywords (e.g., 'what', 'how', 'why', 'when', 'where', 'who', 'is', 'are', 'does', 'can') or punctuation (e.g., '?'). Instead, use your understanding of natural language to interpret the intent. Consider:
           - Does the text imply the user is asking for something to be explained, provided, or clarified?
           - Does the phrasing suggest curiosity, a request, or uncertainty?
           - Context and tone that differentiate it from a statement or command.
        2. If it contains a company name, extract it; otherwise, return null. A company name is any proper noun or entity name explicitly mentioned as a company.

        Return your response as a JSON string with the following format:
        {{
            "is_question": true/false,
            "company": "company_name" or null
        }}

        Examples:
        - "Tell me about gravity" -> {{"is_question": true, "company": null}}
        - "What is gravity" -> {{"is_question": true, "company": null}}
        - "Gravity is interesting" -> {{"is_question": false, "company": null}}
        - "You know about Tesla" -> {{"is_question": true, "company": "Tesla"}}

        Text: {text}
        """,
        expected_output="A JSON string with 'is_question' (boolean) and 'company' (string or null)",
        agent=llm_agent
    )
    crew = Crew(agents=[llm_agent], tasks=[task], process=Process.sequential)
    result = crew.kickoff()
    
    raw_output = result.tasks_output[0].raw.strip()
    print(f"Raw LLM output for '{text}': {raw_output}")
    
    # Clean the raw output by removing code block markers and extra whitespace
    cleaned_output = raw_output.replace('```json', '').replace('```', '').strip()
    
    # Parse the cleaned JSON response
    try:
        output = json.loads(cleaned_output)
        return {
            "is_question": output["is_question"],
            "company": output["company"]
        }
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing LLM output: {e}. Raw output: {raw_output}")
        # Fallback: Minimal logic if LLM fails
        if "my company name is" in text.lower():
            company_name = text.lower().split("my company name is")[-1].strip().split(",")[0].strip()
            is_question = any(phrase in text.lower() for phrase in ["tell me", "please", "explain", "analyse"]) or text.strip().endswith("?")
            return {"is_question": is_question, "company": company_name}
        return {"is_question": any(phrase in text.lower() for phrase in ["tell me", "please explain"]) or text.strip().endswith("?"), "company": None}


def generate_retrieval_response(query: str, is_question: bool) -> str:
    """Generate a natural language response using retrieved context or LLM fallback."""
    contexts = retrieval_agent.retrieve_context(query, top_k=3)
    
    def generate_llm_fallback(query: str):
        """Generate a humorous, human-like fallback response using the LLM."""
        description = f"""
        The user asked: '{query}'. I don’t have relevant info to answer this.
        Create a short, humorous, and conversational response that:
        - Admits I don’t know the answer in a fun way.
        - Redirects the user to ask about 'Impact Analytics' with enthusiasm.
        - Avoids mentioning the context or document explicitly.
        - Keeps it light and human-like.

        Example outputs:
        - "Oh no, I’m totally lost on that! How about Impact Analytics? I’m dying to spill the beans on that!"
        - "Yikes, that’s a stumper! Want to chat about Impact Analytics instead? I’ve got tons to share!"
        """
        task = Task(
            description=description,
            expected_output="A short, humorous natural language response",
            agent=llm_agent
        )
        crew = Crew(agents=[llm_agent], tasks=[task], process=Process.sequential)
        result = crew.kickoff()  # Synchronous call
        return result.tasks_output[0].raw.strip()

    if not contexts or all(not ctx["content"].strip() for ctx in contexts):
        return generate_llm_fallback(query)
    
    retrieved_content = "\n".join([ctx["content"] for ctx in contexts])
    
    # Basic relevance check: any overlap between query and context words
    query_words = set(query.lower().split())
    context_words = set(retrieved_content.lower().split())
    has_overlap = bool(query_words & context_words)
    
    if not has_overlap:
        return generate_llm_fallback(query)
    
    if is_question:
        description = f"""
        Based on the following context, provide a concise answer to the user's question:
        Question: {query}
        Context: {retrieved_content}
        
        Answer in a natural, conversational tone. Keep it brief and to the point.
        """
    else:
        description = f"""
        Based on the following context, provide a relevant response to the user's statement:
        Statement: {query}
        Context: {retrieved_content}
        
        Respond in a natural, conversational tone. Keep it brief and relevant.
        """
    
    task = Task(
        description=description,
        expected_output="A concise natural language response",
        agent=llm_agent
    )
    crew = Crew(agents=[llm_agent], tasks=[task], process=Process.sequential)
    result = crew.kickoff()  # Synchronous call
    return result.tasks_output[0].raw.strip()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Raw input received: {data}")
            try:
                data_dict = json.loads(data)
                user_input = data_dict.get("content", "").strip()
                request_id = data_dict.get("request_id", str(time.time()))
            except json.JSONDecodeError:
                user_input = data.strip()
                request_id = str(time.time())
            print(f"Parsed Request ID: {request_id}, Input: {user_input}")
            
            # Send initial "thinking" with request_id
            await websocket.send_json({"type": "thinking", "request_id": request_id})
            
            retries = 0
            while retries < MAX_RETRIES:
                try:
                    # Use LLM to detect if it's a question                  
                    analysis_result = await detect_question(user_input)
                    is_question = analysis_result["is_question"]
                    company = analysis_result["company"]
                    if not is_question and company is not None and company != "":
                        user_input = company
                    
                    if is_question:
                        # Handle as a retrieval-based query (questions or non-financial statements)
                        await send_agent_update(websocket, "RetrievalAgent", "Thinking..", request_id)
                        response = generate_retrieval_response(user_input, is_question)
                        
                        await websocket.send_json({
                            "type": "question_result",  # Changed from "result" to "question_result"
                            "data": {
                                "matched_paragraphs": response
                            },
                            "request_id": request_id
                        })
                        break
                    else:
                        # Handle as financial data request with existing agents
                        collector_agent = DataCollectorAgent()
                        formatter_agent = DataFormatterAgent()
                        calculator_agent = BenefitCalculatorAgent()
                        summary_agent = SummaryGeneratorAgent()
                        
                        first_crew = Crew(
                            agents=[collector_agent.agent, formatter_agent.agent],
                            tasks=[
                                collector_agent.create_task(user_input, finance_tools, websocket, MAX_RETRIES),
                                formatter_agent.create_task()
                            ],
                            process=Process.sequential,
                            verbose=True
                        )
                        
                        await send_agent_update(websocket, "DataCollectorAgent", "Collecting financial data", request_id)
                        first_result = first_crew.kickoff()
                        await send_agent_update(websocket, "DataFormatterAgent", "Analysing the collected data", request_id)
                        
                        collector_output = first_result.tasks_output[0].raw
                        formatter_output = first_result.tasks_output[1].raw
                        
                        if isinstance(collector_output, str):
                            if "Error" in collector_output or "inventory-based" in collector_output or "No data available" in collector_output:
                                await websocket.send_json({
                                    "type": "message",
                                    "content": collector_output,
                                    "request_id": request_id
                                })
                                break
                            json_match = re.search(r'\{.*\}', collector_output, re.DOTALL)
                            if json_match:
                                json_str = json_match.group(0)
                                json_str = fix_json_string(json_str)
                                json_str = json_str.replace(r'\\$', '$')
                                financial_data = json.loads(json_str)
                            else:
                                await websocket.send_json({
                                    "type": "message",
                                    "content": collector_output,
                                    "request_id": request_id
                                })
                                break
                        else:
                            financial_data = collector_output

                        if isinstance(formatter_output, str):
                            json_match = re.search(r'\{.*\}', formatter_output, re.DOTALL)
                            if json_match:
                                json_str = json_match.group(0)
                                json_str = fix_json_string(json_str)
                                json_str = json_str.replace(r'\\$', '$')
                                financial_data = json.loads(json_str)
                            else:
                                json_str = fix_json_string(formatter_output)
                                json_str = json_str.replace(r'\\$', '$')
                                financial_data = json.loads(json_str)
                        else:
                            financial_data = formatter_output

                        second_crew = Crew(
                            agents=[calculator_agent.agent, summary_agent.agent],
                            tasks=[
                                calculator_agent.create_task(financial_data, finance_tools),
                                summary_agent.create_task()
                            ],
                            process=Process.sequential,
                            verbose=True
                        )
                        
                        await send_agent_update(websocket, "BenefitCalculatorAgent", "Calculating the benefit", request_id)
                        second_result = second_crew.kickoff()
                        await send_agent_update(websocket, "SummaryGeneratorAgent", "Generating summary", request_id)
                        
                        calculator_output = second_result.tasks_output[0].raw
                        summary_output = second_result.tasks_output[1].raw
                        
                        if isinstance(calculator_output, str):
                            json_match = re.search(r'\{.*\}', calculator_output, re.DOTALL)
                            if json_match:
                                json_str = json_match.group(0)
                                json_str = fix_json_string(json_str)
                                json_str = json_str.replace(r'\\$', '$')
                                benefits = json.loads(json_str)
                            else:
                                json_str = fix_json_string(calculator_output)
                                json_str = json_str.replace(r'\\$', '$')
                                benefits = json.loads(json_str)
                        else:
                            benefits = calculator_output

                        summary = summary_output or "Financial data and benefits calculated."
                        
                        await websocket.send_json({
                            "type": "result",
                            "data": {
                                "financial_data": financial_data,
                                "benefits": benefits,
                                "summary": summary
                            },
                            "request_id": request_id
                        })
                        break
                
                except (Exception, json.JSONDecodeError) as e:
                    retries += 1
                    if retries == MAX_RETRIES:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Failed after {MAX_RETRIES} attempts: {str(e)}",
                            "request_id": request_id
                        })
                    else:
                        await websocket.send_json({
                            "type": "message",
                            "content": f"Retry attempt {retries + 1}/{MAX_RETRIES} due to error: {str(e)}",
                            "request_id": request_id
                        })
                        await websocket.send_json({"type": "thinking", "request_id": request_id})
                        time.sleep(2)
            
    except WebSocketDisconnect as e:
        print(f"WebSocket disconnected: {str(e)}")
        await websocket.send_json({"type": "error", "message": "WebSocket connection closed", "request_id": "unknown"})
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        await websocket.send_json({"type": "error", "message": str(e), "request_id": "unknown"})
    finally:
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)